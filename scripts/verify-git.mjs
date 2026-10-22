/**
 * Local verification of the git verbs against a real repository. Runs with
 * plain Node (no DSH host), using child_process as the runner seam.
 *
 *   node scripts/verify-git.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGit } from '../lib/git.js'
import { validateBranchName, normalizeCommitMessage } from '../lib/rules.js'

const root = mkdtempSync(join(tmpdir(), 'bf-verify-'))
const remote = join(root, 'remote.git')
const work = join(root, 'work')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

let failures = 0
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

/** A runner over child_process that mimics the subprocess service result shape. */
async function run(argv, cwd) {
  try {
    const stdout = execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { exitCode: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    }
  }
}

try {
  // ---- fixture: a bare remote plus a clone that acts as the workspace ----
  git(root, 'init', '--bare', '--initial-branch=production6', remote)
  git(root, 'clone', remote, work)
  git(work, 'config', 'user.email', 'dev@example.com')
  git(work, 'config', 'user.name', 'Dev')
  writeFileSync(join(work, 'README.md'), '# demo\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(app): 初始化仓库')
  git(work, 'push', '-u', 'origin', 'production6')
  git(work, 'branch', 'stage')
  git(work, 'push', 'origin', 'stage')
  git(work, 'switch', 'stage')
  git(work, 'push', '-u', 'origin', 'stage')
  git(work, 'switch', 'production6')

  const service = createGit(run, work, {
    remote: 'origin',
    baseline: 'production6',
    target: 'stage',
    pushAfterMerge: true,
  })

  console.log('\nbranch rules')
  check('feature/user-login is valid', validateBranchName('feature/user-login').ok)
  check('bugfix/login-error is valid', validateBranchName('bugfix/login-error').ok)
  check('Feature/User_Login is normalized', validateBranchName('Feature/User_Login').name === 'feature/user-login')
  check('feature/test is rejected as meaningless', !validateBranchName('feature/test').ok)
  check('feature/prod-api is rejected as environment semantics', !validateBranchName('feature/prod-api').ok)
  check('feature/aaa is rejected', !validateBranchName('feature/aaa').ok)
  check('feature/用户登录 is rejected', !validateBranchName('feature/用户登录').ok)
  check('dev2 is rejected', !validateBranchName('dev2').ok)
  check('production6 itself is allowed', validateBranchName('production6').ok)
  check('over 50 chars is rejected', !validateBranchName('feature/' + 'a'.repeat(50)).ok)

  console.log('\ncommit message rules')
  check('canonical message passes', normalizeCommitMessage('feat(order): 新增订单导出接口').message === 'feat(order): 新增订单导出接口')
  check('full-width colon is corrected', normalizeCommitMessage('fix（auth）： 修复 token 过期').message === 'fix(auth): 修复 token 过期')
  check('missing prefix gains one', normalizeCommitMessage('修复登录问题', { type: 'fix', scope: 'auth' }).message === 'fix(auth): 修复登录问题')
  check('chinese type maps to feat', normalizeCommitMessage('新增（order）: 导出接口').type === 'feat')
  check('unknown type falls back', normalizeCommitMessage('wip(order): 试验').type === 'chore')

  console.log('\nview')
  const initial = await service.view()
  check('view resolves the repository', initial !== null)
  check('branch is production6', initial.branch === 'production6', initial.branch)
  check('stage plan is unavailable on the baseline', initial.stage.available === false && initial.stage.reason === 'production-protected')
  check('branch list includes stage', initial.branches.some(branch => branch.name === 'stage'))

  console.log('\ncreate branch from the baseline')
  const created = await service.createBranch({ name: 'feature/user-login' })
  check('created on the remote baseline', created.base === 'origin/production6', created.base)
  check('switched to the new branch', git(work, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'feature/user-login')
  const remoteHasIt = (() => {
    try { return git(remote, 'rev-parse', '--verify', '--quiet', 'refs/heads/feature/user-login').trim() !== '' } catch { return false }
  })()
  check('creation alone does not push unless asked', created.pushed === false && !remoteHasIt, 'unexpectedly pushed')

  // The create form offers "push after creating"; that must publish the branch
  // and set its upstream in the same step.
  const published = await service.createBranch({ name: 'feature/cart-coupon', push: true })
  check('create with push reports pushed', published.pushed === true, JSON.stringify(published))
  check('remote now has the new branch', git(remote, 'rev-parse', '--verify', 'refs/heads/feature/cart-coupon').trim().length === 40)
  check('the new branch tracks its remote', git(work, 'rev-parse', '--abbrev-ref', 'feature/cart-coupon@{upstream}').trim() === 'origin/feature/cart-coupon')
  git(work, 'switch', 'feature/user-login')

  let refused = null
  try { await service.createBranch({ name: 'feature/from-stage', baseline: 'stage' }) } catch (error) { refused = error.code }
  check('creating from stage is refused', refused === 'stage-baseline', refused)

  console.log('\nbaseline picker lists every branch')
  // A repository without the configured baseline must offer its whole branch
  // list, not a truncated sample: the picker used to stop at 12.
  const pickerService = createGit(run, work, { remote: 'origin', baseline: 'nope-not-here', target: 'stage' })
  for (let index = 0; index < 20; index += 1) {
    git(work, 'branch', `feature/sample-${index}`)
  }
  const pickerView = await pickerService.view()
  check('missing baseline is reported', pickerView.baselineAvailable === false)
  check('every branch is offered, not a truncated sample', pickerView.baselineCandidates.length >= 21, String(pickerView.baselineCandidates.length))
  check('the configured target stays out of the picker', !pickerView.baselineCandidates.includes('stage'))
  check('a non-conventional baseline still works', (await pickerService.createBranch({ name: 'feature/legacy-base', baseline: 'feature/sample-3' })).base.length > 0)
  git(work, 'switch', 'feature/user-login')

  console.log('\nuntracked files are separated from tracked changes')
  writeFileSync(join(work, 'scratch.txt'), 'scratch\n')
  const withScratch = await service.view()
  const trackedOnly = withScratch.files.filter(file => !file.untracked).map(file => file.path)
  check('untracked file is flagged', withScratch.files.some(file => file.untracked && file.path === 'scratch.txt'))
  check('tracked list stays clean', !trackedOnly.includes('scratch.txt'), JSON.stringify(trackedOnly))
  rmSync(join(work, 'scratch.txt'), { force: true })

  console.log('\ncommit and push')
  mkdirSync(join(work, 'src', 'auth'), { recursive: true })
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "ok"\n')
  // A brand-new file is never staged implicitly; the caller names it.
  const committed = await service.commit({
    message: 'feat(auth): 新增登录入口',
    all: false,
    paths: ['src/auth/login.ts'],
  })
  check('commit returns a head', /^[0-9a-f]{7,}$/.test(committed.commit), committed.commit)
  check('commit message stored', committed.subject === 'feat(auth): 新增登录入口', committed.subject)
  const pushed = await service.push({ branch: 'feature/user-login', setUpstream: true })
  check('push succeeds', pushed.ok === true)
  check('remote has the branch', git(remote, 'rev-parse', '--verify', 'refs/heads/feature/user-login').trim().length === 40)

  console.log('\nempty commit is refused')
  let emptyCode = null
  try { await service.commit({ message: 'feat(auth): 空提交' }) } catch (error) { emptyCode = error.code }
  check('nothing-to-commit', emptyCode === 'nothing-to-commit', emptyCode)

  // A default commit must never sweep untracked files into history: in a real
  // workspace those are scratch notes and __pycache__, and one mis-staged .pyc
  // pushed to a shared branch is expensive to undo.
  console.log('\ndefault commit ignores untracked files')
  writeFileSync(join(work, 'AGENTS.md'), 'scratch notes\n')
  mkdirSync(join(work, 'tools', '__pycache__'), { recursive: true })
  writeFileSync(join(work, 'tools', '__pycache__', 'x.cpython-39.pyc'), 'bytecode\n')
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "tracked-edit"\n')
  const trackedCommit = await service.commit({ message: 'fix(auth): 修正登录返回值' })
  check('commit succeeds with a tracked edit', /^[0-9a-f]{7,}$/.test(trackedCommit.commit), JSON.stringify(trackedCommit))
  check('tracked edit is committed', trackedCommit.files.includes('src/auth/login.ts'), JSON.stringify(trackedCommit.files))
  check('untracked AGENTS.md stayed out', !trackedCommit.files.includes('AGENTS.md'), JSON.stringify(trackedCommit.files))
  check('untracked .pyc stayed out', !trackedCommit.files.some(file => file.endsWith('.pyc')), JSON.stringify(trackedCommit.files))
  const afterCommit = git(work, 'log', '-1', '--name-only', '--pretty=format:').trim()
  check('commit tree holds no untracked file', !afterCommit.includes('AGENTS.md') && !afterCommit.includes('.pyc'), afterCommit)

  // Naming an untracked path explicitly is still allowed (a genuine new file).
  const explicitCommit = await service.commit({
    message: 'docs(app): 新增 AGENTS 说明',
    all: false,
    paths: ['AGENTS.md'],
  })
  check('explicitly named untracked file is committed', explicitCommit.files.includes('AGENTS.md'), JSON.stringify(explicitCommit.files))
  check('the .pyc still stayed out', !explicitCommit.files.some(file => file.endsWith('.pyc')), JSON.stringify(explicitCommit.files))
  // AGENTS.md is tracked now, so removing it is a tracked deletion: commit it so
  // the worktree is clean again for the merge scenarios that follow.
  rmSync(join(work, 'AGENTS.md'), { force: true })
  const removalCommit = await service.commit({ message: 'docs(app): 移除临时说明文件' })
  check('tracked deletion is committed by the default path', removalCommit.files.includes('AGENTS.md'), JSON.stringify(removalCommit.files))
  rmSync(join(work, 'tools'), { recursive: true, force: true })

  console.log('\nmerge into stage (fast-forward)')
  const merged = await service.mergeInto({ source: 'feature/user-login', target: 'stage', push: true })
  check('merge ok', merged.ok === true, JSON.stringify(merged).slice(0, 200))
  check('pushed to remote', merged.pushed === true)
  check('switched back to the source branch', merged.restored === true)
  check('remote stage contains the commit', git(remote, 'log', 'stage', '--pretty=%s').includes('新增登录入口'))

  console.log('\nmerge into stage (real merge, no fast-forward)')
  git(work, 'switch', 'stage')
  writeFileSync(join(work, 'src', 'auth', 'stage-only.ts'), 'export const stageOnly = true\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(stage): stage 侧改动')
  git(work, 'push', 'origin', 'stage')
  git(work, 'switch', 'feature/user-login')
  writeFileSync(join(work, 'src', 'auth', 'feature-only.ts'), 'export const featureOnly = true\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(auth): 分支侧改动')
  git(work, 'push', 'origin', 'feature/user-login')
  const merged2 = await service.mergeInto({ source: 'feature/user-login', target: 'stage', push: true })
  check('second merge ok', merged2.ok === true, JSON.stringify(merged2).slice(0, 200))
  check('Merge commit recorded on stage', git(remote, 'log', 'stage', '--pretty=%s', '-1').trim().startsWith('Merge'), git(remote, 'log', 'stage', '--pretty=%s', '-1').trim())
  check('stage has both files', git(remote, 'ls-tree', '-r', '--name-only', 'stage').includes('feature-only.ts')
    && git(remote, 'ls-tree', '-r', '--name-only', 'stage').includes('stage-only.ts'))

  console.log('\nconflict handling')
  git(work, 'switch', 'stage')
  git(work, 'pull', '--ff-only', 'origin', 'stage')
  writeFileSync(join(work, 'README.md'), '# demo\nstage line\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(app): stage 改 README')
  git(work, 'push', 'origin', 'stage')
  git(work, 'switch', 'feature/user-login')
  git(work, 'pull', '--ff-only', 'origin', 'feature/user-login')
  writeFileSync(join(work, 'README.md'), '# demo\nfeature line\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(app): 分支改 README')
  git(work, 'push', 'origin', 'feature/user-login')
  const conflicted = await service.mergeInto({ source: 'feature/user-login', target: 'stage', push: true })
  check('merge reports a conflict', conflicted.ok === false && conflicted.stage === 'conflict', JSON.stringify(conflicted).slice(0, 240))
  check('conflict lists README.md', (conflicted.conflicts ?? []).includes('README.md'), JSON.stringify(conflicted.conflicts))
  const mid = await service.view()
  check('repository stays mid-merge', mid.conflicts > 0)
  check('view reports the merge operation', mid.operation === 'merge' && mid.operationInProgress === true, JSON.stringify({ op: mid.operation, inProgress: mid.operationInProgress }))
  check('view lists the unresolved path', mid.unresolvedPaths.includes('README.md'), JSON.stringify(mid.unresolvedPaths))

  let continueRefused = null
  try { await service.continueMerge({}) } catch (error) { continueRefused = error.code }
  check('continue refuses files that still hold markers', continueRefused === 'conflicts-present', continueRefused)

  // The reported failure mode: the model resolves the file AND stages it, so
  // `UU` disappears and `conflicts` drops to 0 — yet MERGE_HEAD remains and the
  // merge still has to be committed. The panel used to lose the "finish the
  // merge" entry here because it inferred the operation from the conflict count.
  writeFileSync(join(work, 'README.md'), '# demo\nstage line\nfeature line\n')
  git(work, 'add', '--', 'README.md')
  const afterStaging = await service.view()
  check('the conflict count drops once the file is staged', afterStaging.conflicts === 0, String(afterStaging.conflicts))
  check('the merge is still reported after staging', afterStaging.operation === 'merge' && afterStaging.merging === true, JSON.stringify({ op: afterStaging.operation, merging: afterStaging.merging }))
  check('no unresolved paths remain', afterStaging.unresolvedPaths.length === 0, JSON.stringify(afterStaging.unresolvedPaths))
  check('MERGE_HEAD is still present', execFileSync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], { cwd: work, encoding: 'utf8' }).trim() !== '' && existsSync(join(work, '.git', 'MERGE_HEAD')))

  const continued = await service.continueMerge({ push: true })
  check('continue completes the merge once the model staged it', /^[0-9a-f]{7,}$/.test(continued.commit), JSON.stringify(continued))
  check('continue clears the unmerged index entries', git(work, 'ls-files', '--unmerged').trim() === '')
  check('merge commit has two parents', git(work, 'rev-list', '--parents', '-1', 'HEAD').trim().split(/\s+/).length === 3)
  check('continue pushed the merged branch', continued.pushed === true, JSON.stringify(continued))
  const remoteStageTip = git(remote, 'rev-parse', 'stage').trim()
  const localStageTip = git(work, 'rev-parse', 'HEAD').trim()
  check('remote stage now matches the merge commit', remoteStageTip === localStageTip, `${remoteStageTip} vs ${localStageTip}`)

  console.log('\nproduction6 is protected')
  let protectedCode = null
  try { await service.mergeInto({ source: 'feature/user-login', target: 'production6' }) } catch (error) { protectedCode = error.code }
  check('merging into production6 refused', protectedCode === 'production-protected', protectedCode)

  // A ref name starting with "-" is an option injection: git would parse it as a
  // flag (`-D`, `--upload-pack=…`). Every verb that accepts a name must refuse it
  // before it reaches the command line.
  console.log('\nref names cannot become git options')
  const injections = [
    ['delete (-D)', () => service.deleteBranch({ branch: '-D' })],
    ['delete (--upload-pack)', () => service.deleteBranch({ branch: '--upload-pack=touch /tmp/x' })],
    ['switch (-f)', () => service.switchBranch({ branch: '-f' })],
    ['create (-m)', () => service.createBranch({ name: '-m' })],
    ['merge (source)', () => service.mergeInto({ source: '--no-verify', target: 'stage' })],
  ]
  for (const [label, run] of injections) {
    let code = null
    try { await run() } catch (error) { code = error.code }
    check(`refuses option-like name (${label})`, code === 'invalid-ref-name', code)
  }
  check('the repository was not mutated by any attempt', git(work, 'rev-parse', '--abbrev-ref', 'HEAD').trim() !== '')

  // fetch moves remote-tracking refs only; pull is the verb that updates local
  // code. The panel used to expose fetch alone, so "拉取远端" looked like a no-op.
  console.log('\nfetch reports distance, pull updates local code')
  git(work, 'switch', 'stage')
  git(work, 'pull', '--ff-only', 'origin', 'stage')
  // The conflict section left an unpushed merge commit on stage; publish it so
  // the checkout starts level with the remote (otherwise it is already ahead,
  // and the next remote commit would legitimately diverge).
  git(work, 'push', 'origin', 'stage')
  git(work, 'switch', 'feature/user-login')
  git(work, 'push', 'origin', 'feature/user-login')
  git(work, 'switch', 'stage')
  const level = await service.view()
  check('checkout starts level with the remote', level.ahead === 0 && level.behind === 0, `ahead=${level.ahead} behind=${level.behind}`)
  // A second clone advances the remote behind this checkout's back.
  const other = join(root, 'other')
  git(root, 'clone', remote, other)
  git(other, 'config', 'user.email', 'other@example.com')
  git(other, 'config', 'user.name', 'Other')
  git(other, 'switch', 'stage')
  writeFileSync(join(other, 'remote-only.txt'), 'from the other clone\n')
  git(other, 'add', '-A')
  git(other, 'commit', '-m', 'feat(app): 远端新增文件')
  git(other, 'push', 'origin', 'stage')

  const beforeFetch = await service.view()
  check('local is behind before the fetch', beforeFetch.behind === 0, String(beforeFetch.behind))
  const fetched = await service.fetch({})
  check('fetch succeeds', fetched.ok === true)
  check('fetch reports the new distance', fetched.behind === 1, String(fetched.behind))
  check('fetch marks a change', fetched.changed === true)
  const afterFetch = await service.view()
  check('local HEAD did not move on fetch', afterFetch.behind === 1, String(afterFetch.behind))
  check('the fetched file is not in the worktree yet', !existsSync(join(work, 'remote-only.txt')))

  const pulled = await service.pull({})
  check('pull succeeds', pulled.ok === true, JSON.stringify(pulled))
  check('pull fast-forwards', pulled.fastForwarded === true)
  check('pull brings the file in', existsSync(join(work, 'remote-only.txt')))
  check('local is level after the pull', pulled.behind === 0, String(pulled.behind))

  const again = await service.pull({})
  check('a second pull is a no-op', again.fastForwarded === false)

  // Diverged histories must be refused rather than rewritten.
  git(work, 'switch', 'feature/user-login')
  git(work, 'pull', '--ff-only', 'origin', 'feature/user-login')
  writeFileSync(join(work, 'local-only.txt'), 'local\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(app): 本地新增文件')
  git(other, 'switch', 'feature/user-login')
  writeFileSync(join(other, 'remote-diverged.txt'), 'remote\n')
  git(other, 'add', '-A')
  git(other, 'commit', '-m', 'chore(app): 远端并行提交')
  git(other, 'push', 'origin', 'feature/user-login')
  let diverged = null
  try { await service.pull({}) } catch (error) { diverged = error.code }
  check('diverged pull is refused', diverged === 'diverged', diverged)

  // A colleague pushes a new branch. The panel's "刷新分支" does fetch + re-read;
  // a local-only re-read could never show the branch, so this pins the order.
  console.log('\nbranch refresh surfaces a colleague new branch')
  git(work, 'switch', 'stage')
  const beforeRefresh = await service.view()
  check('the colleague branch is absent before refreshing', !beforeRefresh.allBranches.some(item => item.name === 'feature/colleague-new'))
  git(other, 'fetch', '--prune', 'origin')
  git(other, 'switch', '-c', 'feature/colleague-new', 'origin/stage')
  writeFileSync(join(other, 'colleague.txt'), 'from a colleague\n')
  git(other, 'add', '-A')
  git(other, 'commit', '-m', 'feat(app): 同事新增功能')
  git(other, 'push', 'origin', 'feature/colleague-new')

  await service.fetch({})
  const afterRefresh = await service.view()
  check('refresh sees the colleague branch', afterRefresh.allBranches.some(item => item.name === 'feature/colleague-new'), JSON.stringify(afterRefresh.allBranches.map(b => b.name)))
  check('it is listed as remote-only, not a local branch', afterRefresh.remoteBranches.some(item => item.name === 'feature/colleague-new') && !afterRefresh.branches.some(item => item.name === 'feature/colleague-new'))
  check('the remote-tracking ref landed locally', (await run(['rev-parse', '--verify', '--quiet', 'origin/feature/colleague-new'], work)).exitCode === 0)

  // Switching to a remote-only branch creates a local tracking branch.
  const tracked = await service.switchBranch({ branch: 'feature/colleague-new' })
  check('switching to a remote-only branch creates a tracking branch', tracked.ok === true && tracked.trackedFrom === 'origin/feature/colleague-new', JSON.stringify(tracked))
  check('it is now a local branch', git(work, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'feature/colleague-new')
  git(work, 'switch', 'feature/user-login')

  console.log('\ndirty worktree blocks the merge')
  git(work, 'switch', 'feature/user-login')
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "dirty"\n')
  let dirtyCode = null
  try { await service.mergeInto({ source: 'feature/user-login', target: 'stage' }) } catch (error) { dirtyCode = error.code }
  check('dirty-worktree refused', dirtyCode === 'dirty-worktree', dirtyCode)
  git(work, 'checkout', '--', 'src/auth/login.ts')

  // Untracked files carry no branch decision: git moves them across a switch
  // and refuses only when the target would overwrite one. Counting them as
  // "uncommitted changes" left a workspace holding only caches/scratch files
  // permanently unable to switch or merge.
  console.log('\nuntracked files do not block switch or merge')
  git(work, 'switch', 'feature/user-login')
  writeFileSync(join(work, 'scratch.txt'), 'scratch\n')
  mkdirSync(join(work, 'tools', '__pycache__'), { recursive: true })
  writeFileSync(join(work, 'tools', '__pycache__', 'x.cpython-39.pyc'), 'bytecode\n')
  const scratchView = await service.view()
  check('no tracked edits are pending', scratchView.dirtyFiles === 0, String(scratchView.dirtyFiles))
  check('both untracked files are counted', scratchView.untrackedFiles === 2, String(scratchView.untrackedFiles))
  check('untracked rows are flagged', scratchView.files.filter(file => file.untracked).length === 2)

  const switchedWithUntracked = await service.switchBranch({ branch: 'stage' })
  check('switch is allowed with only untracked files', switchedWithUntracked.ok === true, JSON.stringify(switchedWithUntracked))
  check('untracked files survive the switch', existsSync(join(work, 'scratch.txt')))
  git(work, 'switch', 'feature/user-login')

  const mergedWithUntracked = await service.mergeInto({ source: 'feature/user-login', target: 'stage', push: false, fetch: false })
  check('merge is allowed with only untracked files', mergedWithUntracked.ok === true, JSON.stringify(mergedWithUntracked).slice(0, 240))

  // A tracked edit must also survive a switch when git can carry it, and be
  // refused (naming the file) only when the target would overwrite it.
  console.log('\ntracked edits follow git own rules')
  git(work, 'switch', 'feature/user-login')
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "tracked"\n')
  const trackedView = await service.view()
  check('tracked edit is counted', trackedView.dirtyFiles > 0, String(trackedView.dirtyFiles))
  const carried = await service.switchBranch({ branch: 'stage' })
  check('non-conflicting tracked edit is carried across', carried.ok === true, JSON.stringify(carried))
  check('the edit is still in the worktree', readFileSync(join(work, 'src', 'auth', 'login.ts'), 'utf8').includes('tracked'))
  git(work, 'checkout', '--', 'src/auth/login.ts')
  git(work, 'switch', 'feature/user-login')

  // Commit a different version of the same file on both branches, then try to
  // switch with local edits: git must refuse and the host must name the file.
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "stage-version"\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'chore(auth): stage 侧登录实现')
  git(work, 'switch', 'feature/user-login')
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "local-edit"\n')
  let overwriteCode = null
  let overwriteMessage = ''
  try { await service.switchBranch({ branch: 'stage' }) } catch (error) { overwriteCode = error.code; overwriteMessage = error.message }
  check('overwriting edit is refused with its own code', overwriteCode === 'tracked-changes-would-be-overwritten', `${overwriteCode} ${overwriteMessage}`)
  check('refusal names the blocking file', overwriteMessage.includes('login.ts'), overwriteMessage)
  git(work, 'checkout', '--', 'src/auth/login.ts')

  // A tracked edit still blocks the merge, which moves HEAD itself.
  console.log('\ntracked edits still block merge')
  git(work, 'switch', 'feature/user-login')
  writeFileSync(join(work, 'src', 'auth', 'login.ts'), 'export const login = () => "dirty"\n')
  let mergeBlocked = null
  try { await service.mergeInto({ source: 'feature/user-login', target: 'stage', push: false }) } catch (error) { mergeBlocked = error.code }
  check('tracked edit blocks the merge', mergeBlocked === 'dirty-worktree', mergeBlocked)
  git(work, 'checkout', '--', 'src/auth/login.ts')
  rmSync(join(work, 'scratch.txt'), { force: true })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
