/**
 * Repeatedly call `view()` and watch process count, latency and memory.
 *
 * The user reports the panel gets slower the longer it runs and eventually
 * freezes the client. Two mechanisms could cause that:
 *
 *   1. A leak — something grows per call (handles, listeners, memory).
 *   2. Queuing — a call costs 12 git spawns, so a 10s poll with no in-flight
 *      guard stacks requests when one call is slower than the interval.
 *
 * This harness measures (1) directly and makes (2) visible by timing each call.
 *
 *   node soak-view.mjs <repo> [iterations]
 */
import { execFileSync } from 'node:child_process'
import { createGit } from '../lib/git.js'

const root = process.argv[2]
const iterations = Number(process.argv[3] ?? 30)
if (!root) {
  console.error('usage: soak-view.mjs <repo> [iterations]')
  process.exit(2)
}

const run = async (argv, cwd) => {
  try {
    return { exitCode: 0, stdout: execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

const git = createGit(run, root, {})

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

const before = process.memoryUsage()
const timings = []

for (let i = 0; i < iterations; i += 1) {
  const started = Date.now()
  await git.view()
  timings.push(Date.now() - started)
}

const after = process.memoryUsage()

const first10 = timings.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, timings.length)
const last10 = timings.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, timings.length)

console.log('iterations   :', iterations)
console.log('heaps          :', mb(before.heapUsed), '->', mb(after.heapUsed), `(delta ${mb(after.heapUsed - before.heapUsed)})`)
console.log('rss            :', mb(before.rss), '->', mb(after.rss), `(delta ${mb(after.rss - before.rss)})`)
console.log('external       :', mb(before.external), '->', mb(after.external))
console.log('first 10 avg   :', first10.toFixed(0), 'ms')
console.log('last 10 avg    :', last10.toFixed(0), 'ms')
console.log('drift          :', ((last10 - first10) / first10 * 100).toFixed(1), '%')
console.log('active handles :', process._getActiveHandles?.().length ?? 'n/a')
console.log('active requests:', process._getActiveRequests?.().length ?? 'n/a')
