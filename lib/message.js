/**
 * AI commit-message drafting over the Host `llm` service. The panel's "AI 优化"
 * button calls this with the staged diff and the plugin's own rules; the reply
 * is normalized through the same rule set the manual path uses, so the result
 * is always `<type>(<scope>): <subject>` or a reported error.
 * @module dsh-branch-flow/message
 */

import { COMMIT_TYPES, deriveScope, deriveType, normalizeCommitMessage } from './rules.js'

/** Diff characters sent to the model (keeps the request small). */
const MAX_DIFF_CHARS = 12_000

/** Per-file diff characters kept when the diff has to be truncated. */
const MAX_FILE_DIFF_CHARS = 2_000

/** System instruction: the exact output contract the model must follow. */
const SYSTEM = [
  'You write git commit messages.',
  'Reply with exactly one line and nothing else: <type>(<scope>): <subject>',
  `type must be one of: ${COMMIT_TYPES.join(', ')}.`,
  'scope is a short lowercase component name (letters, digits, dot, underscore, hyphen).',
  'subject is one Chinese sentence (no trailing period) describing what changed and why, at most 50 characters.',
  'Never add quotes, bullet points, backticks, or explanation.',
].join('\n')

/**
 * Truncate a diff to the request budget, keeping whole per-file blocks where
 * possible so the model still sees which component changed.
 * @param {string} diff - the unified diff text.
 * @returns {string} the (possibly truncated) diff.
 */
export function clipDiff(diff) {
  if (diff.length <= MAX_DIFF_CHARS) return diff
  const blocks = diff.split(/^(?=diff --git )/m)
  let budget = MAX_DIFF_CHARS
  const kept = []
  for (const block of blocks) {
    if (budget <= 0) break
    const slice = block.slice(0, Math.min(block.length, MAX_FILE_DIFF_CHARS, budget))
    kept.push(slice)
    budget -= slice.length
  }
  return `${kept.join('')}\n... (diff truncated)`
}

/** Extract the plain text of a streamed reply. */
function textOf(chunks) {
  let text = ''
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text
}

/**
 * Build the message generator over one Host context.
 * @param {{ get(name: string): unknown, llm?: any, agentDefaultModel?: any }} ctx
 * @param {() => Promise<{ provider?: string, model?: string } | null> | ({ provider?: string, model?: string } | null)} resolveFallback
 * @returns {(input: { diff: string, files: string[], branch: string, subject?: string }, signal?: AbortSignal) => Promise<object>}
 */
export function createMessageDrafter(ctx, resolveFallback) {
  return async function draft(input, signal) {
    const llm = ctx.get('llm') ?? ctx.llm
    if (llm === undefined || llm === null) {
      return { ok: false, error: '当前装配里没有可用的模型服务（llm），无法生成提交信息' }
    }

    let selection = null
    try {
      const modelService = ctx.get('agentDefaultModel') ?? ctx.agentDefaultModel
      selection = modelService?.currentSelection?.() ?? null
    } catch {
      selection = null
    }
    if (selection === null || selection.provider === undefined) {
      const fallback = await resolveFallback()
      if (fallback === null) {
        return { ok: false, error: '没有可用的默认模型，请先在设置里选择模型' }
      }
      selection = fallback
    }

    const files = Array.isArray(input.files) ? input.files : []
    const scope = deriveScope(files)
    const type = deriveType(input.branch)
    const userText = [
      `分支：${input.branch}`,
      `改动文件（${files.length}）：`,
      files.slice(0, 60).map(file => `- ${file}`).join('\n'),
      '',
      '按分支前缀建议 type 为：' + type + '，建议 scope 为：' + scope,
      input.subject ? `当前草稿：${input.subject}（请改写得更准确）` : '',
      '',
      'Diff:',
      clipDiff(String(input.diff ?? '')),
    ].filter(Boolean).join('\n')

    const chunks = []
    try {
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        maxTokens: 200,
        signal,
      })) {
        chunks.push(chunk)
        if (chunk.type === 'finish') {
          if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
            return { ok: false, error: chunk.reason?.failure?.message ?? '模型调用失败' }
          }
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const raw = textOf(chunks).trim().split('\n').map(line => line.trim()).filter(Boolean)[0] ?? ''
    if (raw === '') return { ok: false, error: '模型没有返回可用的提交信息' }

    const normalized = normalizeCommitMessage(raw.replace(/^["'`]+|["'`]+$/g, ''), { type, scope })
    return {
      ok: normalized.ok,
      message: normalized.message,
      raw,
      issues: normalized.issues,
      provider: selection.provider,
      model: selection.model,
    }
  }
}
