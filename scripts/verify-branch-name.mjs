/**
 * Verify the branch-name suggestion normalizer: whatever shape a model answers
 * in, the result must be a rule-conforming name or an explicit rejection.
 *
 *   node scripts/verify-branch-name.mjs
 */
import { normalizeBranchSuggestion } from '../lib/branch-name.js'
import { validateBranchName } from '../lib/rules.js'

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

const cases = [
  ['plain name', 'feature/user-login', 'feature/user-login', true],
  ['markdown fenced', '```\nfeature/order-export\n```', 'feature/order-export', true],
  ['backticks', '`bugfix/login-error`', 'bugfix/login-error', true],
  ['quoted', '"feature/pay-service"', 'feature/pay-service', true],
  ['git command prefix', 'git switch -c feature/cart-coupon', 'feature/cart-coupon', true],
  ['checkout -b prefix', 'git checkout -b hotfix/pay-timeout', 'hotfix/pay-timeout', true],
  ['uppercase repaired', 'Feature/User-Login', 'feature/user-login', true],
  ['underscores repaired', 'feature/user_login', 'feature/user-login', true],
  ['unknown prefix repaired', 'feat/order-export', 'feature/order-export', true],
  ['extra explanation on later lines', 'feature/user-login\n\nThis name follows the rules.', 'feature/user-login', true],
]

for (const [label, input, expected, expectOk] of cases) {
  const result = normalizeBranchSuggestion(input)
  check(label, result.ok === expectOk && result.branch === expected, `${result.ok} ${result.branch}`)
}

// Anything produced must satisfy the same validator the form uses.
for (const [label, input] of cases) {
  const result = normalizeBranchSuggestion(input)
  if (!result.ok) continue
  const valid = validateBranchName(result.branch, { allowEnvBranches: false })
  check(`accepted output passes the form rules (${label})`, valid.ok, result.branch)
}

// Unusable replies are rejected rather than silently accepted.
const rejected = [
  ['empty', ''],
  ['only prose', 'I think a good name would be something for the login flow'],
  ['chinese', '功能/用户登录'],
  ['no prefix', 'userlogin'],
  ['meaningless', 'feature/test'],
  ['environment word', 'feature/prod-api'],
]
for (const [label, input] of rejected) {
  const result = normalizeBranchSuggestion(input)
  check(`rejects ${label}`, result.ok === false, `${result.ok} ${result.branch}`)
}

// The prefix repair is reported so the panel can say it corrected something.
const repaired = normalizeBranchSuggestion('feat/cart-coupon')
check('prefix repair is reported', repaired.issues.some(item => item.code === 'prefix-repaired'), JSON.stringify(repaired.issues))

// Length guard: an over-long suggestion is refused, not truncated silently.
const long = normalizeBranchSuggestion(`feature/${'a'.repeat(60)}`)
check('over-long suggestion is rejected', long.ok === false, long.branch)

console.log(failures === 0 ? '\nALL BRANCH-NAME CHECKS PASSED' : `\n${failures} BRANCH-NAME CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
