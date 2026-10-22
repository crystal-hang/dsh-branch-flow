/**
 * The host git plumbing: one spawn-per-verb runner over `ctx.subprocess`, the
 * status/branch/commit views the panel renders, and the mutating verbs the
 * one-click flows need (commit, push, fetch, merge, abort, switch, create).
 *
 * Every mutating verb is workspace-gated by the route layer; nothing here
 * accepts a path that the browser supplied without that check.
 * @module dsh-branch-flow/git
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Collected-output cap for one git command. */
const OUTPUT_CAP_BYTES = 1 << 20

/** Grace period before a stuck git child is killed. */
const GRACE_MS = 60_000

/** The environment branches the product fixes by name (rules 4 and 5). */
export const PRODUCTION_BRANCH = 'production6'
export const STAGE_BRANCH = 'stage'

/** Default settings; the plugin Config overrides them per profile. */
const DEFAULTS = {
  remote: 'origin',
  baseline: PRODUCTION_BRANCH,
  target: STAGE_BRANCH,
  pushAfterMerge: true,
}

/** One git verb rejection: `code` is a stable key the client maps to copy. */
export class GitOpError extends Error {
  /**
   * @param {string} code - stable rejection code.
   * @param {string} message - host-authored English detail.
   * @param {string[]} [argv] - the command that failed.
   */
  constructor(code, message, argv = []) {
    super(message)
    this.name = 'GitOpError'
    this.code = code
    this.argv = argv
  }
}

/**
 * One finished git invocation.
 * @typedef {{ exitCode: number | null, stdout: string, stderr: string }} GitRun
 */

/**
 * The collected s
tdout/stderr of a finished handle.
 * @param {any} handle - a subprocess handle.
 * @returns {{ stdout: string, stderr: string }}
 */
function readCollected(handle) {
  return {
    stdout: handle.collected?.stdout?.readFrom(0)?.text ?? '',
    stderr: handle.collected?.stderr?.readFrom(0)?.text ?? '',
  }
}

/** A git ref name that cannot be mistaken for a command-line option. */
function assertRefName(name, argv) {
  // A leading dash would be parsed as an option (`-D`, `--upload-pack=…`), and
  // control characters never belong in a ref. Both are refused outright rather
  // than passed through and left to git's own diagnostics.
  if (name.startsWith('-') || /[\0\n\r]/.test(name)) {
    throw new GitOpError('invalid-ref-name', `「${name}」不是合法的分支名`, argv)
  }
  return name
}

/**
 * A runner bound to one context's subprocess service.
 * @param {{ subprocess: any }} ctx - a context carrying the subprocess service.
 * @returns {(argv: string[], cwd: string, signal?: AbortSignal) => Promise<GitRun>}
 */
export function gitRunner(ctx) {
  return async function run(argv, cwd, signal) {
    signal?.throwIfAborted?.()
    const handle = ctx.subprocess.spawn({
      argv: ['git', ...argv],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: OUTPUT_CAP_BYTES },
        stderr: { maxBytes: OUTPUT_CAP_BYTES },
      },
      graceMs: GRACE_MS,
      signal,
    })
    const outcome = await handle.done
    const output = readCollected(handle)
    return { exitCode: outcome.exitCode, ...output }
  }
}

/** Fold a command's output into one readable line. */
function failureOf(run) {
  const text = `${run.stderr}\n${run.stdout}`.trim()
  return text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8).join(' | ')
}

/**
 * The git service over one workspace root. Every method resolves a plain
 * result object and reports expected git failures as {@link GitOpError}.
 * @param {ReturnType<typeof gitRunner>} run - the runner.
 * @param {string} root - canonical workspace path (already gated).
 * @param {{ remote?: string, baseline?: string, target?: string, pushAfterMerge?: boolean }} [options]
 */
export function createGit(run, root, options = {}) {
  const settings = {
    remote: options.remote || DEFAULTS.remote,
    baseline: options.baseline || DEFAULTS.baseline,
    target: options.target || DEFAULTS.target,
    pushAfterMerge: options.pushAfterMerge !== false,
  }

  /** Run git and return the raw result. */
  const exec = (argv, signal) => run(argv, root, signal)

  /** Run git and throw a {@link GitOpError} on a non-zero exit. */
  const must = async (argv, signal, code = 'git-failed') => {
    const result = await exec(argv, signal)
    if (result.exitCode !== 0) {
      throw new GitOpError(code, failureOf(result) || `git ${argv[0]} failed`, argv)
    }
    return result
  }

  /** Resolve an abbreviated ref, or null when it does not exist. */
  const revParse = async (ref, signal) => {
    const result = await exec(['rev-parse', '--verify', '--quiet', ref], signal)
    return result.exitCode === 0 ? result.stdout.trim() : null
  }

  const service = {
    root,
    settings,

    /**
     * The full panel snapshot: repository identity, worktree state, branch
     * position, the branch list, and the staged one-click plan.
     * @param {AbortSignal} [signal] - cancellation.
     */
    async view(signal) {
      const top = await exec(['rev-parse', '--show-toplevel'], signal)
      if (top.exitCode !== 0) return null
      const canonicalRoot = top.stdout.trim()

      const [branchRun, headRun, statusRun, remoteRun] = await Promise.all([
        exec(['rev-parse', '--abbrev-ref', 'HEAD'], signal),
        exec(['rev-parse', '--short', 'HEAD'], signal),
        exec(['status', '--porcelain=v2', '--branch'], signal),
        exec(['remote'], signal),
      ])

      const branch = branchRun.exitCode === 0 ? branchRun.stdout.trim() : ''
      const head = headRun.exitCode === 0 ? headRun.stdout.trim() : ''
      const status = parseStatus(statusRun.stdout)
      const remotes = remoteRun.exitCode === 0
        ? remoteRun.stdout.split('\n').map(line => line.trim()).filter(Boolean)
        : []
      const remote = remotes.includes(settings.remote) ? settings.remote : (remotes[0] ?? '')

      const [filesRun, aheadRun, upstreamRun] = await Promise.all([
        exec(['status', '--porcelain=v1', '--untracked-files=all'], signal),
        branch === '' || remote === ''
          ? Promise.resolve({ exitCode: 1, stdout: '', stderr: '' })
          : exec(['rev-list', '--left-right', '--count', `${branch}...${remote}/${branch}`], signal),
        branch === ''
          ? Promise.resolve({ exitCode: 1, stdout: '', stderr: '' })
          : exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`], signal),
      ])

      const files = parseFiles(filesRun.stdout)
      let ahead = 0
      let behind = 0
      if (aheadRun.exitCode === 0) {
        const parts = aheadRun.stdout.trim().split(/\s+/)
        ahead = Number.parseInt(parts[0] ?? '0', 10) || 0
        behind = Number.parseInt(parts[1] ?? '0', 10) || 0
      }
      const upstream = upstreamRun.exitCode === 0 ? upstreamRun.stdout.trim() : ''

      const branchesRun = await exec([
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:relative)%09%(upstream:short)%09%(upstream:track)',
        'refs/heads',
      ], signal)
      const localBranches = parseBranches(branchesRun.stdout, branch, {
        baseline: settings.baseline,
        target: settings.target,
      })

      // Remote-only branches: a colleague pushes one, `fetch` brings the ref in
      // but nothing creates a local branch, so a local-only list can never show
      // it. They are listed separately so switching to one is still a deliberate
      // "create tracking branch" action rather than an implicit local ref.
      const remoteBranches = []
      if (remote !== '') {
        const remoteRun = await exec([
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:relative)',
          `refs/remotes/${remote}`,
        ], signal)
        if (remoteRun.exitCode === 0) {
          const localNames = new Set(localBranches.map(item => item.name))
          for (const line of remoteRun.stdout.split('\n')) {
            if (line.trim() === '') continue
            const [refName, head, updated] = line.split('\t')
            if (!refName || refName.endsWith('/HEAD')) continue
            const name = refName.startsWith(`${remote}/`) ? refName.slice(remote.length + 1) : refName
            if (localNames.has(name)) continue
            remoteBranches.push({
              name,
              head: head ?? '',
              updated: updated ?? '',
              remote,
              current: false,
              environment: name === settings.baseline || name === settings.target,
              protected: name === settings.baseline || name === settings.target,
              prefix: name.includes('/') ? name.split('/')[0] : '',
            })
          }
        }
      }
      const branches = localBranches
      const allBranches = localBranches.concat(remoteBranches)

      // The configured baseline may not exist in every repository: report that
      // together with the branches the repository actually has, so the panel can
      // offer a one-time override instead of failing every create with a
      // "base-ref-not-found" the user cannot act on.
      const baselineRefs = [settings.baseline, ...(remote === '' ? [] : [`${remote}/${settings.baseline}`])]
      let baselineAvailable = false
      for (const ref of baselineRefs) {
        if (await revParse(ref, signal) !== null) { baselineAvailable = true; break }
      }
      // Every existing branch except the merge target is a legal baseline —
      // local and remote-only alike, since branching from origin/<name> is
      // exactly what createBranch prefers. Deliberately complete: a repository
      // may carry dozens of branches, and truncating hides the needed one.
      const baselineCandidates = allBranches
        .map(item => item.name)
        .filter(name => name !== settings.target && name !== settings.baseline)
        .sort((a, b) => {
          const rank = name => (name === 'master' || name === 'main' ? 0 : 1)
          return rank(a) - rank(b) || a.localeCompare(b)
        })

      // An in-progress operation is a fact in the git directory, not a property
      // of the worktree: once every conflict is staged the `UU` entries and the
      // conflict count disappear, yet MERGE_HEAD still exists and the merge is
      // genuinely unfinished. Detecting it from `conflicts > 0` therefore lost
      // the "finish the merge" state exactly when the user had resolved it.
      const operation = await detectOperation(exec, canonicalRoot, signal)

      return {
        root: canonicalRoot,
        branch,
        head,
        detached: branch === '',
        dirtyFiles: status.dirtyFiles,
        untrackedFiles: status.untrackedFiles,
        conflicts: status.conflicts,
        operation: operation?.kind ?? null,
        operationInProgress: operation !== null,
        /** True while a merge is open, even with every conflict resolved. */
        merging: operation?.kind === 'merge',
        /** Files still carrying unmerged index entries (the classic UU rows). */
        unresolvedPaths: operation?.unresolved ?? [],
        remotes,
        remote,
        upstream,
        ahead,
        behind,
        files,
        branches,
        remoteBranches,
        allBranches,
        baselineAvailable,
        baselineCandidates,
        stage: stageView(branch, settings),
        settings: { ...settings },
        productionBranch: settings.baseline,
        stageBranch: settings.target,
      }
    },

    /** Fetch one remote, pruning deleted refs (network; may be slow). */
    async fetch(input = {}, signal) {
      const remote = String(input.remote ?? settings.remote)
      if (remote === '') throw new GitOpError('no-remote', '仓库没有配置远端', ['fetch'])
      const before = await service.view(signal)
      await must(['fetch', '--prune', remote], signal, 'fetch-failed')
      const after = await service.view(signal)
      // fetch only moves remote-tracking refs; local branches are untouched.
      // Report the resulting distance so the panel can say what changed instead
      // of leaving an identical screen that looks like a no-op.
      return {
        ok: true,
        remote,
        branch: after?.branch ?? '',
        ahead: after?.ahead ?? 0,
        behind: after?.behind ?? 0,
        before: before === null ? null : { ahead: before.ahead, behind: before.behind },
        changed: before === null || after === null
          ? false
          : before.ahead !== after.ahead || before.behind !== after.behind,
      }
    },

    /**
     * Fast-forward the current branch to its upstream. This is the verb that
     * actually updates local code after a fetch; it refuses when the local
     * branch has diverged, so no history is rewritten behind the user's back.
     * @param {{ remote?: string }} input
     * @param {AbortSignal} [signal]
     */
    async pull(input = {}, signal) {
      const remote = String(input.remote ?? settings.remote)
      if (remote === '') throw new GitOpError('no-remote', '仓库没有配置远端', ['pull'])
      const state = await service.view(signal)
      if (state === null) throw new GitOpError('not-a-repository', '当前目录不是 Git 仓库', ['pull'])
      if (state.branch === '') throw new GitOpError('detached-head', '当前处于分离 HEAD，无法拉取', ['pull'])
      if (state.dirtyFiles > 0) {
        throw new GitOpError('dirty-worktree', `有 ${state.dirtyFiles} 个已跟踪文件的改动未提交，先提交或储藏再拉取`, ['pull'])
      }
      const fetched = await exec(['fetch', '--prune', remote], signal)
      if (fetched.exitCode !== 0) {
        throw new GitOpError('fetch-failed', `拉取 ${remote} 失败：${failureOf(fetched)}`, ['fetch'])
      }
      const upstream = state.upstream !== '' ? state.upstream : `${remote}/${state.branch}`
      if (await revParse(upstream, signal) === null) {
        throw new GitOpError('no-upstream', `${state.branch} 在 ${remote} 上没有对应分支`, ['pull'])
      }
      const merged = await exec(['merge', '--ff-only', upstream], signal)
      if (merged.exitCode !== 0) {
        throw new GitOpError('diverged', `${state.branch} 与 ${upstream} 已分叉，需要手动合并`, ['merge'])
      }
      const after = await service.view(signal)
      return {
        ok: true,
        branch: state.branch,
        upstream,
        fastForwarded: !/Already up to date/.test(merged.stdout),
        ahead: after?.ahead ?? 0,
        behind: after?.behind ?? 0,
      }
    },

    /**
     * Stage the selected paths (default: every tracked change), commit, report.
     *
     * Only files git already tracks are staged by default. `git add --all` also
     * picks up untracked files, which in a real workspace means scratch notes,
     * `__pycache__/*.pyc` and build output — those must never ride along just
     * because someone pressed "one click". New files are committed only when the
     * caller names them explicitly (`paths`, with `all: false`).
     *
     * @param {{ message: string, paths?: string[], all?: boolean, includeUntracked?: boolean }} input
     * @param {AbortSignal} [signal]
     */
    async commit(input, signal) {
      const message = String(input.message ?? '').trim()
      if (message === '') throw new GitOpError('empty-message', '提交信息为空', ['commit'])

      if (input.all === false) {
        const paths = Array.isArray(input.paths) ? input.paths.filter(path => typeof path === 'string' && path !== '') : []
        if (paths.length === 0) throw new GitOpError('no-paths-selected', '没有选择要提交的文件', ['add'])
        // Named paths may legitimately be new files, so `--all` is scoped to them.
        await must(['add', '--all', '--', ...paths], signal, 'stage-failed')
      } else if (input.includeUntracked === true) {
        // Explicit opt-in only (the panel's "show untracked" toggle).
        await must(['add', '--all'], signal, 'stage-failed')
      } else {
        // Tracked changes only: update the index for files git already knows.
        await must(['add', '--update'], signal, 'stage-failed')
      }

      const staged = await exec(['diff', '--cached', '--name-only'], signal)
      if (staged.stdout.trim() === '') {
        throw new GitOpError('nothing-to-commit', '没有可提交的改动（工作区是干净的）', ['commit'])
      }

      const stagedFiles = staged.stdout.split('\n').map(line => line.trim()).filter(Boolean)
      const diff = await exec(['diff', '--cached', '--patch'], signal)
      await must(['commit', '-m', message], signal, 'commit-failed')
      const [commit, subject] = await Promise.all([
        exec(['rev-parse', '--short', 'HEAD'], signal),
        exec(['log', '-1', '--pretty=%s'], signal),
      ])
      return {
        commit: commit.stdout.trim(),
        subject: subject.stdout.trim(),
        files: stagedFiles,
        diff: diff.stdout,
      }
    },

    /**
     * Push the current branch. Adds `--set-upstream` when the branch has none.
     * @param {{ branch?: string, remote?: string, setUpstream?: boolean }} input
     * @param {AbortSignal} [signal]
     */
    async push(input = {}, signal) {
      const branch = String(input.branch ?? '')
      if (branch === '') throw new GitOpError('detached-head', '当前处于分离 HEAD，无法推送', ['push'])
      const remote = String(input.remote ?? settings.remote)
      if (remote === '') throw new GitOpError('no-remote', '仓库没有配置远端', ['push'])
      const args = ['push']
      if (input.setUpstream === true) args.push('--set-upstream')
      args.push(remote, branch)
      const result = await exec(args, signal)
      if (result.exitCode !== 0) {
        throw new GitOpError('push-failed', failureOf(result) || 'push failed', args)
      }
      return { ok: true, branch, remote, output: failureOf(result) }
    },

    /**
     * The IDEA-style "Merge into": merge `source` into `target`. Fast-forwards
     * when possible and records a merge commit otherwise.
     *
     * Sequence: refuse on a dirty tree or an unfinished operation, fetch,
     * switch to the target, fast-forward it from its upstream, merge, push,
     * then switch back to where the user was. A conflict leaves the repository
     * mid-merge and returns the conflicting paths so the panel can hand the
     * fix to the model.
     * @param {{ source?: string, target?: string, push?: boolean, fetch?: boolean }} input
     * @param {AbortSignal} [signal]
     */
    async mergeInto(input = {}, signal) {
      const source = assertRefName(String(input.source ?? ''), ['merge'])
      const target = assertRefName(String(input.target ?? settings.target), ['merge'])
      if (source === '') throw new GitOpError('missing-source', '缺少源分支', ['merge'])
      if (source === target) throw new GitOpError('same-branch', '源分支与目标分支相同', ['merge'])
      if (target === settings.baseline) {
        throw new GitOpError('production-protected', `${settings.baseline} 只作为基线，禁止直接合并或推送到它`, ['merge'])
      }

      const initial = await service.view(signal)
      if (initial === null) throw new GitOpError('not-a-repository', '当前目录不是 Git 仓库', ['rev-parse'])
      if (initial.conflicts > 0 || initial.operationInProgress) {
        throw new GitOpError('operation-in-progress', `仓库中有未完成的 ${initial.operation ?? 'Git 操作'}，请先继续或放弃`, ['merge'])
      }
      if (initial.dirtyFiles > 0) {
        throw new GitOpError('dirty-worktree', `工作区有 ${initial.dirtyFiles} 个已跟踪文件的改动未提交，请先提交或撤销`, ['merge'])
      }

      const steps = []
      if (input.fetch !== false && initial.remote !== '') {
        const fetched = await exec(['fetch', '--prune', initial.remote], signal)
        steps.push(fetched.exitCode === 0
          ? `fetch ${initial.remote}`
          : `fetch ${initial.remote} 失败（继续用本地引用）：${failureOf(fetched)}`)
      }

      if (initial.branch !== target) {
        const switched = await exec(['switch', '--no-guess', target], signal)
        if (switched.exitCode !== 0) {
          throw new GitOpError('switch-failed', `切换到 ${target} 失败：${failureOf(switched)}`, ['switch'])
        }
        steps.push(`switch ${target}`)
      }

      const targetExists = await revParse(`refs/heads/${target}`, signal)
      if (targetExists === null) {
        throw new GitOpError('target-branch-not-found', `目标分支 ${target} 不存在`, ['rev-parse'])
      }

      if (initial.remote !== '') {
        const upstreamRef = `${initial.remote}/${target}`
        if (await revParse(upstreamRef, signal) !== null) {
          const fastForward = await exec(['merge', '--ff-only', upstreamRef], signal)
          if (fastForward.exitCode !== 0) {
            steps.push(`${target} 与 ${upstreamRef} 已分叉，跳过快进`)
          } else if (!/Already up to date/.test(fastForward.stdout)) {
            steps.push(`fast-forward ${target} 到 ${upstreamRef}`)
          }
        }
      }

      const merge = await exec(['merge', '--no-edit', source], signal)
      if (merge.exitCode !== 0) {
        const after = await service.view(signal)
        const conflicting = after === null ? [] : after.files.filter(file => file.conflict).map(file => file.path)
        if (conflicting.length > 0) {
          return {
            ok: false,
            stage: 'conflict',
            source,
            target,
            steps,
            conflicts: conflicting,
            message: `合并 ${source} 到 ${target} 时发生 ${conflicting.length} 个文件冲突`,
          }
        }
        const cleaned = await exec(['merge', '--abort'], signal)
        throw new GitOpError('merge-failed', `${failureOf(merge)}${cleaned.exitCode === 0 ? '（已回滚合并）' : ''}`, ['merge'])
      }
      steps.push(/Fast-forward/.test(merge.stdout) ? `fast-forward 合并 ${source}` : `合并 ${source} 到 ${target}`)

      let pushed = false
      if (input.push !== false && initial.remote !== '' && settings.pushAfterMerge) {
        const pushedRun = await exec(['push', initial.remote, target], signal)
        if (pushedRun.exitCode !== 0) {
          return {
            ok: false,
            stage: 'push-failed',
            source,
            target,
            steps,
            message: `已合并但推送 ${target} 失败：${failureOf(pushedRun)}`,
          }
        }
        pushed = true
        steps.push(`push ${initial.remote} ${target}`)
      }

      let restored = false
      if (initial.branch !== '' && initial.branch !== target) {
        const back = await exec(['switch', '--no-guess', initial.branch], signal)
        restored = back.exitCode === 0
        if (restored) steps.push(`switch 回 ${initial.branch}`)
      }

      const head = await exec(['rev-parse', '--short', 'HEAD'], signal)
      return { ok: true, stage: 'merged', source, target, steps, pushed, restored, commit: head.stdout.trim() }
    },

    /** Abort an in-progress merge and restore the pre-merge tree. */
    async abortMerge(_input = {}, signal) {
      const result = await exec(['merge', '--abort'], signal)
      if (result.exitCode !== 0) {
        throw new GitOpError('no-merge-in-progress', failureOf(result) || '没有可中止的合并', ['merge', '--abort'])
      }
      return { ok: true }
    },

    /**
     * After the conflicts were resolved: stage everything and finish the merge
     * commit. Refuses while conflict markers remain.
     * @param {{ message?: string }} input
     * @param {AbortSignal} [signal]
     */
    /**
     * Finish an in-progress merge once the conflicts are resolved.
     *
     * The unmerged index entries (`UU`) are what keep the merge open, and only
     * `git add` clears them — so a gate that refuses while `UU` entries exist
     * would deadlock itself. The real precondition is whether any conflicted
     * file still CONTAINS conflict markers; when the markers are gone the file
     * is resolved, and staging it is exactly the step that settles the index.
     *
     * When `push` is requested the merge commit is pushed to the target branch
     * immediately, so "let the model fix it, then finish" ends with the remote
     * updated instead of leaving a second manual step.
     *
     * @param {{ message?: string, push?: boolean, target?: string }} input
     * @param {AbortSignal} [signal]
     */
    async continueMerge(input = {}, signal) {
      const status = await service.view(signal)
      if (status === null) throw new GitOpError('not-a-repository', '当前目录不是 Git 仓库', ['status'])

      // Conflicted paths still carry markers? Then the resolution is incomplete.
      const conflicted = status.files.filter(file => file.conflict).map(file => file.path)
      const stillMarked = []
      for (const path of conflicted) {
        const scan = await exec(['grep', '--no-color', '-l', '-E', '^(<<<<<<< |=======|>>>>>>> )', '--', path], signal)
        // exit 0 = markers found; 1 = clean; anything else = not a text file, so
        // treat the absence of a match as resolved and let git decide.
        if (scan.exitCode === 0 && scan.stdout.trim() !== '') stillMarked.push(path)
      }
      if (stillMarked.length > 0) {
        throw new GitOpError(
          'conflicts-present',
          `还有 ${stillMarked.length} 个文件残留冲突标记：${stillMarked.slice(0, 5).join('、')}`,
          ['add'],
        )
      }

      // Stage the resolution: `-u` covers modified/deleted tracked files, then the
      // conflicted paths are added explicitly so an unmerged entry always settles
      // even when git no longer lists it as a worktree modification.
      await must(['add', '--update'], signal, 'stage-failed')
      if (conflicted.length > 0) {
        await must(['add', '--', ...conflicted], signal, 'stage-failed')
      }

      // A merge whose index is fully settled must not still hold unmerged entries.
      const unmerged = await exec(['ls-files', '--unmerged'], signal)
      if (unmerged.stdout.trim() !== '') {
        const left = new Set(unmerged.stdout.split('\n').map(line => line.split('\t').pop()?.trim()).filter(Boolean))
        throw new GitOpError('conflicts-present', `仍有未解决的条目：${[...left].slice(0, 5).join('、')}`, ['add'])
      }

      const message = typeof input.message === 'string' && input.message.trim() !== '' ? input.message.trim() : null
      const args = message === null ? ['commit', '--no-edit'] : ['commit', '-m', message]
      const commit = await exec(args, signal)
      if (commit.exitCode !== 0) {
        throw new GitOpError('commit-failed', failureOf(commit) || '完成合并提交失败', ['commit'])
      }
      const head = await exec(['rev-parse', '--short', 'HEAD'], signal)
      const branch = (await exec(['rev-parse', '--abbrev-ref', 'HEAD'], signal)).stdout.trim()

      let pushed = false
      if (input.push !== false && branch !== '' && settings.pushAfterMerge) {
        const remote = input.remote ?? settings.remote
        if (remote !== '') {
          const pushResult = await exec(['push', remote, branch], signal)
          if (pushResult.exitCode !== 0) {
            return {
              ok: true,
              commit: head.stdout.trim(),
              branch,
              pushed: false,
              pushError: failureOf(pushResult) || 'push failed',
            }
          }
          pushed = true
        }
      }

      return { ok: true, commit: head.stdout.trim(), branch, pushed }
    },

    /**
     * Create a branch from the freshly fetched production6 baseline and switch
     * to it. The baseline is mandatory: creating from stage is refused.
     * @param {{ name: string, baseline?: string }} input
     * @param {AbortSignal} [signal]
     */
    async createBranch(input = {}, signal) {
      const name = assertRefName(String(input.name ?? ''), ['switch'])
      const baseline = String(input.baseline ?? settings.baseline)
      if (name === '') throw new GitOpError('invalid-branch-name', '分支名为空', ['switch'])
      if (baseline === settings.target) {
        throw new GitOpError('stage-baseline', `统一基线：所有分支只能从 ${settings.baseline} 切出，禁止从 ${settings.target} 切出`, ['switch'])
      }
      // The baseline is an existing ref, not a new branch, so the naming rules
      // do not apply to it: a repository may keep branches whose names predate
      // this convention. Only refs that git itself cannot resolve are refused.
      if (/[\s~^:?*[\\]|\.\./.test(baseline) || baseline.startsWith('-')) {
        throw new GitOpError('invalid-baseline', `基线名「${baseline}」不是合法的 Git 引用`, ['switch'])
      }

      if (await revParse(`refs/heads/${name}`, signal) !== null) {
        throw new GitOpError('branch-already-exists', `本地分支 ${name} 已存在`, ['switch'])
      }

      const state = await service.view(signal)
      if (state !== null && (state.dirtyFiles > 0)) {
        throw new GitOpError('dirty-worktree', `有 ${state.dirtyFiles} 个已跟踪文件的改动未提交，请先提交或储藏再切分支`, ['switch'])
      }
      if (state !== null && state.remote !== '') {
        const fetched = await exec(['fetch', '--prune', state.remote], signal)
        if (fetched.exitCode !== 0) {
          throw new GitOpError('fetch-failed', `拉取 ${state.remote} 失败：${failureOf(fetched)}`, ['fetch'])
        }
      }

      let base = baseline
      const remoteBase = state?.remote ? `${state.remote}/${baseline}` : ''
      if (remoteBase !== '' && await revParse(remoteBase, signal) !== null) base = remoteBase
      if (await revParse(base, signal) === null) {
        throw new GitOpError('base-ref-not-found', `基线分支 ${baseline} 不存在`, ['rev-parse'])
      }

      const created = await exec(['switch', '--no-guess', '-c', name, base], signal)
      if (created.exitCode !== 0) {
        throw new GitOpError('create-failed', `创建分支失败：${failureOf(created)}`, ['switch'])
      }

      // Optionally publish the new branch immediately. A push failure does not
      // undo the local branch: it is reported separately so the caller can retry
      // without recreating anything.
      let pushed = false
      let pushError
      if (input.push === true && state !== null && state.remote !== '') {
        const pushResult = await exec(['push', '--set-upstream', state.remote, name], signal)
        if (pushResult.exitCode === 0) {
          pushed = true
        } else {
          pushError = failureOf(pushResult) || 'push failed'
        }
      }
      return { ok: true, branch: name, base, pushed, ...(pushError === undefined ? {} : { pushError }) }
    },

    /**
     * Switch to an existing local branch.
     *
     * There is no "is the worktree clean" gate here on purpose: git already
     * decides correctly, carrying uncommitted edits and untracked files across
     * when they do not conflict with the target, and refusing with the exact
     * paths when they do. Pre-blocking on a file count would reject switches
     * git happily performs (and did, for workspaces holding only caches).
     */
    async switchBranch(input = {}, signal) {
      const name = assertRefName(String(input.branch ?? ''), ['switch'])
      if (name === '') throw new GitOpError('invalid-branch-name', '分支名为空', ['switch'])
      const state = await service.view(signal)
      if (state !== null && state.conflicts > 0) {
        throw new GitOpError('conflicts-present', '仓库中还有未解决的冲突，先处理完再切换分支', ['switch'])
      }

      // A branch that exists only on the remote needs a local tracking branch
      // first; `git switch --no-guess` would otherwise refuse an unknown name.
      const localExists = await revParse(`refs/heads/${name}`, signal) !== null
      if (!localExists) {
        const remoteName = state?.remote ?? ''
        const remoteRef = remoteName === '' ? null : `${remoteName}/${name}`
        if (remoteRef !== null && await revParse(`refs/remotes/${remoteRef}`, signal) !== null) {
          const tracked = await exec(['switch', '--no-guess', '-c', name, '--track', remoteRef], signal)
          if (tracked.exitCode !== 0) {
            throw new GitOpError('switch-failed', failureOf(tracked) || `创建跟踪分支 ${name} 失败`, ['switch'])
          }
          return { ok: true, branch: name, trackedFrom: remoteRef }
        }
      }

      const result = await exec(['switch', '--no-guess', name], signal)
      if (result.exitCode !== 0) {
        const detail = failureOf(result)
        // git refuses only when the target would overwrite local work; surface
        // that as its own code so the panel can name the blocking files.
        if (/would be overwritten|Your local changes|Please commit your changes or stash/i.test(detail)) {
          const paths = [...detail.matchAll(/^\s*(\S.*)$/gm)]
            .map(match => match[1].trim())
            .filter(line => line !== '' && !/^(error|hint|Please|Aborting|Your local)/i.test(line))
            .slice(0, 8)
          throw new GitOpError('tracked-changes-would-be-overwritten', `切换到 ${name} 会覆盖以下已修改文件：${paths.join('、') || detail}`, ['switch'])
        }
        throw new GitOpError('switch-failed', detail || `切换到 ${name} 失败`, ['switch'])
      }
      return { ok: true, branch: name }
    },

    /** Delete one local branch; the environment branches are protected. */
    async deleteBranch(input = {}, signal) {
      const name = assertRefName(String(input.branch ?? ''), ['branch'])
      if (name === '') throw new GitOpError('invalid-branch-name', '分支名为空', ['branch'])
      if (name === settings.baseline || name === settings.target) {
        throw new GitOpError('protected-branch', `${name} 是环境分支，不能删除`, ['branch'])
      }
      const state = await service.view(signal)
      if (state !== null && state.branch === name) {
        throw new GitOpError('current-branch', '不能删除当前所在的分支', ['branch'])
      }
      const result = await exec(['branch', input.force === true ? '-D' : '-d', name], signal)
      if (result.exitCode !== 0) {
        throw new GitOpError('delete-failed', failureOf(result) || `删除 ${name} 失败`, ['branch'])
      }
      return { ok: true, branch: name }
    },

    /**
     * The staged diff of the current worktree (used by the message drafter).
     * @param {AbortSignal} [signal]
     */
    async worktreeDiff(signal) {
      const [tracked, untracked] = await Promise.all([
        exec(['diff', 'HEAD'], signal),
        exec(['ls-files', '--others', '--exclude-standard'], signal),
      ])
      return {
        diff: tracked.stdout,
        untracked: untracked.stdout.split('\n').map(line => line.trim()).filter(Boolean),
      }
    },
  }

  return service
}

/** Parse `git status --porcelain=v2 --branch`. */
export function parseStatus(stdout) {
  let dirtyFiles = 0
  let untrackedFiles = 0
  let conflicts = 0
  let head = null
  let oid = null
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    if (line.startsWith('#')) {
      const header = /^# branch\.(oid|head) (.*)$/.exec(line)
      if (header !== null) {
        if (header[1] === 'oid') oid = header[2].trim()
        else head = header[2].trim()
      }
      continue
    }
    const type = line[0]
    if (type === '1' || type === '2') dirtyFiles += 1
    else if (type === '?') untrackedFiles += 1
    else if (type === 'u') conflicts += 1
    else if (type === '!') continue
    else dirtyFiles += 1
  }
  const branch = head === null || head.startsWith('(') || oid === '(initial)' ? '' : head
  return { branch, dirtyFiles, untrackedFiles, conflicts }
}

/**
 * Parse `git status --porcelain=v1` into per-file rows the panel lists and
 * toggles. Rename entries keep the destination path.
 * @param {string} stdout
 */
export function parseFiles(stdout) {
  const files = []
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue
    const index = line[0]
    const worktree = line[1]
    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ').pop() ?? path
    path = path.trim()
    if (path === '') continue
    const conflict = index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A')
      || (index === 'D' && worktree === 'D')
    const untracked = index === '?' && worktree === '?'
    files.push({ path, index, worktree, conflict, untracked })
  }
  return files
}

/** Parse the `for-each-ref` branch table. */
export function parseBranches(stdout, current, roles = {}) {
  const branches = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [name, head, relative, upstream, track] = line.split('\t')
    if (!name) continue
    const aheadMatch = /ahead (\d+)/.exec(track ?? '')
    const behindMatch = /behind (\d+)/.exec(track ?? '')
    branches.push({
      name,
      head: head ?? '',
      updated: relative ?? '',
      upstream: upstream ?? '',
      ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
      behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
      current: name === current,
      environment: name === roles.baseline || name === roles.target,
      protected: name === roles.baseline || name === roles.target,
      prefix: name.includes('/') ? name.split('/')[0] : '',
    })
  }
  return branches
}

/** The one-click plan for the current branch (read-only preview). */
function stageView(branch, settings) {
  if (branch === '') {
    return { available: false, reason: 'detached-head', source: '', target: settings.target }
  }
  if (branch === settings.baseline) {
    return { available: false, reason: 'production-protected', source: branch, target: settings.target }
  }
  if (branch === settings.target) {
    return { available: false, reason: 'already-on-stage', source: branch, target: settings.target }
  }
  return { available: true, reason: '', source: branch, target: settings.target }
}

/**
 * Identify an in-progress git operation from the markers git writes into its
 * own directory. These outlive conflict resolution: after every `UU` entry is
 * staged, MERGE_HEAD remains until the merge is committed or aborted, so this is
 * the only reliable signal that "finish the merge" is still an available action.
 *
 * @param {(argv: string[], signal?: AbortSignal) => Promise<{ exitCode: number | null, stdout: string }>} exec
 *   runner already bound to the repository root.
 * @param {string} root - canonical repository root, used to resolve marker paths.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ kind: string, unresolved: string[] } | null>}
 */
async function detectOperation(exec, root, signal) {
  // `--git-path` resolves each marker to a real path inside the git directory
  // (worktrees included), so existence can be tested on disk directly.
  const resolved = await exec(
    ['rev-parse', '--git-path', 'MERGE_HEAD', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply',
      '--git-path', 'CHERRY_PICK_HEAD', '--git-path', 'REVERT_HEAD'],
    signal,
  )
  if (resolved.exitCode !== 0) return null
  const paths = resolved.stdout.split('\n').map(line => line.trim()).filter(Boolean)
  const order = ['merge', 'rebase', 'rebase', 'cherry-pick', 'revert']

  let kind = null
  for (let index = 0; index < order.length; index += 1) {
    const path = paths[index]
    if (path === undefined) continue
    const absolute = isAbsolute(path) ? path : join(root, path)
    if (existsSync(absolute)) { kind = order[index]; break }
  }
  if (kind === null) return null

  const unmerged = await exec(['ls-files', '--unmerged'], signal)
  const unresolved = [...new Set(
    (unmerged.exitCode === 0 ? unmerged.stdout : '')
      .split('\n')
      .map(line => line.split('\t').pop()?.trim())
      .filter(Boolean),
  )]
  return { kind, unresolved }
}
