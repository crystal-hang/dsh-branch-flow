/**
 * Branch naming + commit message rules, shared logic. The browser half carries
 * an identical copy (the client bundle is one self-contained module), so keep
 * the two in sync when changing a rule.
 *
 * Branch rules (the product's own convention):
 *  1. lowercase only, words joined by '-', no '_', no camelCase, no spaces;
 *  2. only A-Z a-z 0-9 '-' '/' — no CJK, no other punctuation;
 *  3. at most 50 characters;
 *  4. no self-invented environment names (prod/test/uat/release2/dev2 ...),
 *     the only environment branches being production6 and stage;
 *  5. the name must express an environment or a purpose — no test1/aaa/tmp/new;
 *  6. always a slash-prefixed hierarchy: feature/ bugfix/ hotfix/ release/.
 *
 * Commit rules: `<type>(<scope>): <subject>` with a fixed type vocabulary.
 * @module dsh-branch-flow/rules
 */

/** The only allowed branch prefixes (rule 6). */
export const PREFIXES = ['feature', 'bugfix', 'hotfix', 'release']

/** The only allowed environment branch names (rule 4). */
export const ENV_BRANCHES = ['production6', 'stage']

/** The commit type vocabulary, in the order the product lists it. */
export const COMMIT_TYPES = [
  'feat', 'fix', 'refactor', 'perf', 'docs', 'style',
  'test', 'build', 'ci', 'chore', 'revert',
]

/** Branch prefixes that make a `feat` commit the natural default. */
const PREFIX_TYPE = {
  feature: 'feat',
  bugfix: 'fix',
  hotfix: 'fix',
  release: 'chore',
}

/** Chinese / informal type words the user or a model may write. */
const TYPE_SYNONYMS = {
  feature: 'feat', features: 'feat', feat: 'feat', '新增': 'feat', '新功能': 'feat', '功能': 'feat',
  bug: 'fix', bugfix: 'fix', fix: 'fix', hotfix: 'fix', '修复': 'fix', '缺陷': 'fix', 'bug修复': 'fix',
  refactor: 'refactor', '重构': 'refactor',
  perf: 'perf', performance: 'perf', '优化': 'perf', '性能': 'perf', '性能优化': 'perf',
  docs: 'docs', doc: 'docs', '文档': 'docs',
  style: 'style', '格式': 'style', '样式': 'style',
  test: 'test', tests: 'test', '测试': 'test',
  build: 'build', '构建': 'build', '依赖': 'build',
  ci: 'ci', '流水线': 'ci',
  chore: 'chore', '杂项': 'chore',
  revert: 'revert', '回滚': 'revert',
}

/** Words that carry no purpose on their own (rule 5). */
const MEANINGLESS = new Set([
  'tmp', 'temp', 'test', 'testing', 'new', 'old', 'aaa', 'aaaa', 'abc', 'abcd',
  'foo', 'bar', 'baz', 'asdf', 'demo', 'tmp1', 'xx', 'xxx', 'dev', 'work',
  'change', 'changes', 'update', 'updates', 'fix', 'fixes', 'code', 'stuff',
])

/** Environment-semantics words a branch description may not use (rule 4). */
const ENV_WORDS = /^(prod|production|staging|stage|uat|qa|test|testing|dev|release|sandbox)\d*$/

/** Maximum branch name length (rule 3). */
export const MAX_BRANCH_LENGTH = 50

/** Recommended maximum subject length. */
export const MAX_SUBJECT_LENGTH = 72

/** One rule finding: `error` blocks, `warn` is advisory. */
const issue = (code, level, message, field) => ({ code, level, message, field })

/**
 * Normalize a raw branch name into the rule shape (lowercase, hyphens for
 * spaces and underscores, collapsed separators). Never throws.
 * @param {string} raw - what the user typed.
 * @returns {string} the normalized candidate.
 */
export function normalizeBranchName(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[（）()【】[\]{}]/g, '')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[-/]+/, '')
    .replace(/[-/]+$/, '')
    .toLowerCase()
}

/**
 * Validate one branch name against the six rules.
 * @param {string} raw - the branch name (normalization is applied first).
 * @param {{ allowEnvBranches?: boolean }} [options] - allow production6/stage themselves.
 * @returns {{ ok: boolean, name: string, normalized: string, issues: Array<object>, prefix: string, description: string, type: string }}
 */
export function validateBranchName(raw, options = {}) {
  const allowEnvBranches = options.allowEnvBranches !== false
  const original = String(raw ?? '').trim()
  const name = normalizeBranchName(original)
  /** @type {Array<object>} */
  const issues = []

  if (original !== name) {
    issues.push(issue('normalized', 'warn', '已按规则规范化：小写、连字符、去除多余符号', 'name'))
  }
  if (name === '') {
    issues.push(issue('empty', 'error', '分支名不能为空', 'name'))
    return { ok: false, name, normalized: name, issues, prefix: '', description: '', type: 'feat' }
  }
  if (allowEnvBranches && ENV_BRANCHES.includes(name)) {
    return { ok: true, name, normalized: name, issues, prefix: '', description: name, type: 'chore' }
  }
  if (name.length > MAX_BRANCH_LENGTH) {
    issues.push(issue('too-long', 'error', `分支名长度 ${name.length}，不得超过 ${MAX_BRANCH_LENGTH} 个字符`, 'name'))
  }
  if (!/^[a-z0-9\-/]+$/.test(name)) {
    issues.push(issue('charset', 'error', '只允许英文、数字、- 和 /（禁止中文与特殊符号）', 'name'))
  }

  const segments = name.split('/').filter(Boolean)
  const prefix = segments[0] ?? ''
  const description = segments.slice(1).join('/')

  if (segments.length < 2) {
    issues.push(issue('missing-prefix', 'error', '必须使用正斜杠层级前缀：feature/、bugfix/、hotfix/、release/', 'name'))
  } else if (!PREFIXES.includes(prefix)) {
    issues.push(issue('bad-prefix', 'error', `前缀必须是 ${PREFIXES.join('、')} 之一，当前为「${prefix}」`, 'name'))
  }
  if (segments.length > 2) {
    issues.push(issue('nested', 'error', '前缀之后只接一段英文简述，不再加斜杠', 'name'))
  }
  if (description !== '') {
    if (description.length < 3) {
      issues.push(issue('too-short', 'error', '前缀后的英文简述至少 3 个字符', 'name'))
    }
    const words = description.split('-').filter(Boolean)
    for (const word of words) {
      if (/^\d+$/.test(word)) {
        issues.push(issue('numeric-word', 'error', `「${word}」是纯数字，无法表达目的`, 'name'))
      } else if (MEANINGLESS.has(word)) {
        issues.push(issue('meaningless', 'error', `「${word}」是无意义名称，请说明具体目的`, 'name'))
      } else if (ENV_WORDS.test(word)) {
        issues.push(issue('env-semantic', 'error', `「${word}」是环境语义，禁止自造环境分支名`, 'name'))
      } else if (word.length < 2) {
        issues.push(issue('short-word', 'error', `「${word}」太短，请使用完整英文单词`, 'name'))
      }
    }
  }

  const ok = !issues.some(item => item.level === 'error')
  return {
    ok,
    name,
    normalized: name,
    issues,
    prefix: PREFIXES.includes(prefix) ? prefix : '',
    description,
    type: PREFIX_TYPE[prefix] ?? 'feat',
  }
}

/** Convert full-width punctuation that Chinese input methods produce. */
function toAsciiPunctuation(text) {
  return text
    .replace(/：/g, ':')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/[　\u00a0]/g, ' ')
}

/** Strip characters a scope may not carry. */
function sanitizeScope(scope) {
  return String(scope ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '')
}

/**
 * Normalize and validate one commit message against `<type>(<scope>): <subject>`.
 * Fixable deviations are corrected and reported as warnings; unfixable content
 * becomes an error.
 * @param {string} raw - the message the user typed (or a model produced).
 * @param {{ type?: string, scope?: string }} [hints] - derived type/scope to fill gaps.
 * @returns {{ ok: boolean, message: string, type: string, scope: string, subject: string, issues: Array<object> }}
 */
export function normalizeCommitMessage(raw, hints = {}) {
  const hintType = COMMIT_TYPES.includes(hints.type) ? hints.type : undefined
  const hintScope = sanitizeScope(hints.scope) || 'app'
  /** @type {Array<object>} */
  const issues = []

  let text = toAsciiPunctuation(String(raw ?? '')).trim()
  if (text !== String(raw ?? '').trim()) {
    issues.push(issue('punctuation', 'warn', '已把全角标点替换为英文标点', 'message'))
  }

  let type = hintType ?? 'feat'
  let scope = ''
  let subject = ''

  const matched = /^([A-Za-z\u4e00-\u9fa5]+)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]+)$/.exec(text)
  if (matched !== null) {
    const rawType = matched[1].toLowerCase()
    const mapped = TYPE_SYNONYMS[rawType] ?? (COMMIT_TYPES.includes(rawType) ? rawType : undefined)
    if (mapped !== undefined) {
      type = mapped
    } else {
      type = hintType ?? 'chore'
      issues.push(issue('unknown-type', 'warn', `未识别的 type「${matched[1]}」，已改为 ${type}`, 'type'))
    }
    if (matched[1] !== type) {
      issues.push(issue('type-case', 'warn', `type 已规范为小写 ${type}`, 'type'))
    }
    scope = sanitizeScope(matched[2])
    subject = matched[3]
  } else {
    subject = text
    type = hintType ?? 'feat'
    issues.push(issue('missing-type', 'warn', `缺少 type(scope): 前缀，已补为 ${type}(${hintScope})`, 'type'))
  }

  if (scope === '') {
    scope = hintScope
  } else if (scope !== String(matched?.[2] ?? '').trim()) {
    issues.push(issue('scope-charset', 'warn', `scope 只保留字母数字与 _ . -，已规范为 ${scope}`, 'scope'))
  }

  subject = subject
    .replace(/\s+/g, ' ')
    .replace(/[。.]+$/g, '')
    .trim()

  if (subject === '') {
    issues.push(issue('empty-subject', 'error', '提交说明不能为空', 'subject'))
    subject = 'update'
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    issues.push(issue('long-subject', 'warn', `说明长度 ${subject.length}，建议不超过 ${MAX_SUBJECT_LENGTH}`, 'subject'))
  }
  if (subject !== subject.toLowerCase() && /^[A-Z]/.test(subject) && /^[A-Za-z\s]+$/.test(subject)) {
    subject = subject.charAt(0).toLowerCase() + subject.slice(1)
  }

  const message = `${type}(${scope}): ${subject}`
  const ok = !issues.some(item => item.level === 'error')
  return { ok, message, type, scope, subject, issues }
}

/**
 * Derive a scope from a repository-relative path: the first directory below a
 * conventional source root, else the first two segments' last name.
 * @param {readonly string[]} paths - repository-relative changed paths.
 * @returns {string} a sanitized scope candidate.
 */
export function deriveScope(paths) {
  const directories = []
  for (const path of paths) {
    const parts = String(path).split('/').filter(Boolean)
    if (parts.length === 0) continue
    const slice = parts.length > 1 ? parts.slice(0, parts.length - 1) : parts
    const preferred = slice.find(part => !['src', 'app', 'lib', 'packages', 'source', 'main', 'java', 'com'].includes(part.toLowerCase()))
    directories.push(preferred ?? slice[slice.length - 1] ?? 'app')
  }
  if (directories.length === 0) return 'app'
  const counts = new Map()
  for (const directory of directories) counts.set(directory, (counts.get(directory) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return sanitizeScope(ranked[0]?.[0] ?? 'app') || 'app'
}

/**
 * Derive a type from a branch name's prefix, defaulting to feat.
 * @param {string} branch - the source branch name.
 * @returns {string} one of {@link COMMIT_TYPES}.
 */
export function deriveType(branch) {
  const prefix = String(branch ?? '').split('/')[0]
  return PREFIX_TYPE[prefix] ?? 'feat'
}
