/**
 * Measure how `view()` cost scales with the number of branches and files.
 *
 * The user reports the panel opens more slowly the longer the plugin is used.
 * Branch count is the one thing this plugin makes grow: every "create branch"
 * adds one, and colleagues push more to the remote over time. `view()` reads
 * the full local and remote ref list on every poll, and the client then renders
 * every one of them into the DOM.
 *
 * This harness builds throwaway repositories with 10 / 100 / 400 / 1000
 * branches and times `view()` on each, so the growth curve is measured rather
 * than assumed.
 *
 *   node measure-branch-cost.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGit } from '../lib/git.js'

const node = process.execPath
const counts = [10, 100, 400, 1000]

const runIn = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const run = async (argv, cwd) => {
  try {
    return { exitCode: 0, stdout: execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

console.log('branches | view ms | local | remote')
console.log('---------+---------+-------+-------')

for (const count of counts) {
  const dir = mkdtempSync(join(tmpdir(), 'bf-scale-'))
  try {
    runIn(dir, ['init', '-q', '-b', 'master'])
    runIn(dir, ['config', 'user.email', 'a@b.c'])
    runIn(dir, ['config', 'user.name', 'a'])
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    runIn(dir, ['add', 'a.txt'])
    runIn(dir, ['commit', '-q', '-m', 'init'])

    // Create `count` local branches pointing at the same commit, and publish
    // half of them as remote-tracking refs to mimic a shared repository.
    for (let i = 0; i < count; i += 1) {
      runIn(dir, ['branch', `feature/branch-${i}`, 'master'])
    }
    const refs = []
    for (let i = 0; i < Math.floor(count / 2); i += 1) {
      const sha = runIn(dir, ['rev-parse', 'master']).trim()
      refs.push(`create refs/remotes/origin/feature/branch-${i} ${sha}`)
    }
    if (refs.length > 0) {
      execFileSync('git', ['update-ref', '--stdin'], { cwd: dir, input: refs.join('\n') + '\n' })
    }

    const git = createGit(run, dir, { remote: 'origin' })
    // Warm-up run so the first measurement is not paying disk-cache costs.
    await git.view()
    const started = Date.now()
    const v = await git.view()
    const elapsed = Date.now() - started

    console.log(
      `${String(count).padStart(8)} | ${String(elapsed).padStart(7)} | ${String(v.branches.length).padStart(5)} | ${String(v.remoteBranches.length).padStart(6)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('')
console.log('Re-run to confirm the curve is stable rather than disk-cache noise.')
