/**
 * Count how many git processes one `view()` call spawns and how long it takes.
 *
 * The bar polls every 30s and the panel every 10s while visible, so a view that
 * spawns N processes costs 6N (bar) + 6N (panel) processes per minute. If that
 * number is large, or the cost grows with repository size, this is the source of
 * the "gets slower the longer it runs" report.
 *
 *   node measure-view.mjs <repo-path>
 */
import { execFileSync } from 'node:child_process'
import { createGit } from '../lib/git.js'

const root = process.argv[2]
if (!root) {
  console.error('usage: measure-view.mjs <repo>')
  process.exit(2)
}

let spawns = 0
const calls = []
const run = async (argv, cwd) => {
  spawns += 1
  const started = Date.now()
  try {
    const stdout = execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    calls.push({ argv: argv.join(' '), ms: Date.now() - started })
    return { exitCode: 0, stdout, stderr: '' }
  } catch (error) {
    calls.push({ argv: argv.join(' '), ms: Date.now() - started })
    return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

const git = createGit(run, root, {})

// Warm up, then measure a steady-state view.
await git.view()
spawns = 0
calls.length = 0

const started = Date.now()
const view = await git.view()
const elapsed = Date.now() - started

console.log('repo        :', root)
console.log('view spawns :', spawns)
console.log('view latency:', elapsed, 'ms')
console.log('local brs   :', view.branches.length)
console.log('remote brs  :', view.remoteBranches.length)
console.log('files       :', view.files.length)
console.log('')
console.log('per-call cost:')
for (const call of calls.sort((a, b) => b.ms - a.ms)) {
  console.log(`  ${String(call.ms).padStart(5)} ms  git ${call.argv}`)
}

// The two pollers: bar every 30s, panel every 10s while both are visible.
const perMinute = spawns * 2 + spawns * 6
console.log('')
console.log('processes/minute with bar+panel both visible:', perMinute)
console.log('processes/minute with only the bar visible :', spawns * 2)
