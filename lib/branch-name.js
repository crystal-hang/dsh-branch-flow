/**
 * AI branch-name drafting over the Host `llm` service.
 *
 * A user describes what they are about to do ("给学员列表加导出"), and the model
 * proposes a rule-conforming branch name. The reply is normalized and validated
 * through the same rule set the manual path uses, so the panel can show exactly
 * what will be created and why a candidate was rejected.
 * @module dsh-branch-flow/branch-name
 */

import { PREFIXES, normalizeBranchName, validateBranchName } from './rules.js'

/** The output contract: one name, lowercase ascii, hyphen-separated. */
const SYSTEM = [
  'You name git branches for a Chinese development team.',
  'You receive a requirement written in Chinese and reply with exactly one branch name and nothing else.',
  `It must start with one of: ${PREFIXES.join(', ')} followed by "/".`,
  'After the slash, translate the CORE business noun and action of the requirement into English, then write 2-4 lowercase English words joined by hyphens.',
  'Be specific: name the actual feature, page, or component from the requirement. Never answer generic filler such as general-improvement, some-feature, update-code, or new-function.',
  'Only a-z, 0-9, "-" and one "/" are allowed. No Chinese characters, no spaces, no underscores, no uppercase, no trailing period.',
  'Keep the whole name under 50 characters.',
  'Name the purpose, not the environment. Never use prod, test, uat, dev, tmp, or new.',
  'Examples:',
  '  给学员列表加导出功能 -> feature/student-list-export',
  '  修复微信一键登录 token 过期未刷新 -> bugfix/wx-login-token-refresh',
  '  订单列表页性能优化 -> perf/order-list-query',
].join('\n')

/** Extract the plain text of a streamed reply. */
function textOf(chunks) {
  let text = ''
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text
}

/**
 * Turn one model reply into a rule-shaped candidate.
 *
 * Models occasionally wrap the name in backticks, prefix it with `git switch -c`,
 * or answer in Chinese. Every fixable deviation is repaired here; anything that
 * cannot be repaired comes back as `ok: false` with the rule issues attached.
 * @param {string} raw - the model's reply.
 * @returns {{ ok: boolean, branch: string, issues: Array<object>, raw: string }}
 */
export function normalizeBranchSuggestion(raw) {
  let text = String(raw ?? '').trim()

  // Strip markdown fences, quotes, and a leading `git switch -c` / `git checkout -b`.
  text = text.replace(/^```[\w-]*\n?/gm, '').replace(/```$/gm, '').trim()
  text = text.replace(/^git\s+(?:switch|checkout)\s+(?:-c|-b)\s+/i, '').trim()
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim()
  // Keep the first line only: a model that explains itself would otherwise fail.
  text = text.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''

  const branch = normalizeBranchName(text)
  const checked = validateBranchName(branch, { allowEnvBranches: false })

  // A model reply with a slash but an unknown prefix is repaired to feature/,
  // which is the overwhelmingly common intent.
  if (!checked.ok && branch.includes('/') && checked.prefix === '') {
    const tail = branch.split('/').slice(1).join('-')
    const repaired = normalizeBranchName(`feature/${tail}`)
    const second = validateBranchName(repaired, { allowEnvBranches: false })
    if (second.ok) {
      return {
        ok: true,
        branch: second.name,
        issues: [{ code: 'prefix-repaired', level: 'warn', field: 'name' }],
        raw: String(raw ?? ''),
      }
    }
  }

  return {
    ok: checked.ok,
    branch: checked.name,
    issues: checked.issues,
    raw: String(raw ?? ''),
  }
}

/**
 * Build the branch-name generator over one Host context.
 * @param {{ get(name: string): unknown, llm?: any }} ctx
 * @param {() => Promise<{ provider?: string, model?: string } | null> | ({ provider?: string, model?: string } | null)} resolveFallback
 * @returns {(input: { description: string, prefix?: string }, signal?: AbortSignal) => Promise<object>}
 */
export function createBranchNameDrafter(ctx, resolveFallback) {
  return async function draft(input, signal) {
    const llm = ctx.get('llm') ?? ctx.llm
    if (llm === undefined || llm === null) {
      return { ok: false, error: '当前装配里没有可用的模型服务（llm），无法生成分支名' }
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

    const description = String(input?.description ?? '').trim()
    if (description === '') {
      return { ok: false, error: '请先描述这次要做的需求' }
    }
    const prefix = PREFIXES.includes(input?.prefix) ? input.prefix : null

    const userText = [
      `需求描述：${description}`,
      prefix === null
        ? '请自行判断最合适的前缀：新功能用 feature，修缺陷用 bugfix，线上紧急用 hotfix，发版准备用 release。'
        : `必须使用前缀 ${prefix}/，不要换成别的前缀。`,
      '只输出分支名本身。',
    ].join('\n')

    const chunks = []
    try {
      for await (const chunk of llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        // A reasoning model spends tokens before emitting text, so this budget
        // must cover the thinking as well as the one-line answer.
        maxTokens: 600,
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

    const raw = textOf(chunks)
    if (raw.trim() === '') {
      // Distinguish "the model produced only reasoning" from a silent failure so
      // the panel can say something actionable.
      const hadReasoning = chunks.some(chunk => chunk.type === 'reasoning-delta')
      return {
        ok: false,
        error: hadReasoning
          ? '模型只输出了思考过程，没有给出分支名，请重试'
          : '模型没有返回可用的分支名',
      }
    }

    const normalized = normalizeBranchSuggestion(raw)

    // The user picked a prefix in the form; honour it even when the model
    // thought otherwise, by re-prefixing the descriptive tail.
    if (prefix !== null && normalized.branch !== '' && normalized.branch.split('/')[0] !== prefix) {
      const tail = normalized.branch.includes('/')
        ? normalized.branch.split('/').slice(1).join('-')
        : normalized.branch
      const forced = normalizeBranchSuggestion(`${prefix}/${tail}`)
      return {
        ok: forced.ok,
        branch: forced.branch,
        raw: normalized.raw,
        issues: [...(forced.issues ?? []), { code: 'prefix-forced', level: 'warn', field: 'name' }],
        provider: selection.provider,
        model: selection.model,
      }
    }

    return {
      ok: normalized.ok,
      branch: normalized.branch,
      raw: normalized.raw,
      issues: normalized.issues,
      provider: selection.provider,
      model: selection.model,
    }
  }
}
