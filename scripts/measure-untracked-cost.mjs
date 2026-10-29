/**
 * Measure how `view()` cost scales with the number of *untracked* files.
 *
 * This is the growth vector that matches "the longer I use it, the slower it
 * gets": a working repository accumulates build output, logs, caches and
 * scratch files over days. `view()` asks git for
 * `status --porcelain=v1 --untracked-files=all`, so every one of those files is
 * listed, parsed into an object, serialised into the HTTP response, and then
 * filtered and mapped into React elements in the browser.
 *
 * The panel hides untracked files by default, but hiding happens *after* the
 * whole list has already been transferred and parsed — so the cost is paid
 * whether or not they are displayed.
 *
 *   node measure-untracked-cost.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGit } from '../lib/git.js'

const counts = [0, 1000, 10_000, 40_000]

const runIn = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const run = async (argv, cwd) => {
  try {
    return { exitCode: 0, stdout: execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

console.log('untracked | view ms | payload KB | file objects')
console.log('----------+---------+------------+-------------')

for (const count of counts) {
  const dir = mkdtempSync(join(tmpdir(), 'bf-untracked-'))
  try {
    runIn(dir, ['init', '-q', '-b', 'master'])
    runIn(dir, ['config', 'user.email', 'a@b.c'])
    runIn(dir, ['config', 'user.name', 'a'])
    writeFileSync(join(dir, 'tracked.txt'), 'hello\n')
    runIn(dir, ['add', 'tracked.txt'])
    runIn(dir, ['commit', '-q', '-m', 'init'])

    // Build output looks exactly like this: many small files in deep folders.
    for (let bucket = 0; bucket < Math.ceil(count / 500); bucket += 1) {
      const bucketDir = join(dir, 'build', `chunk-${bucket}`)
      mkdirSync(bucketDir, { recursive: true })
      for (let i = 0; i < 500 && bucket * 500 + i < count; i += 1) {
        writeFileSync(join(bucketDir, `artifact-${i}.js`), 'x'.repeat(64))
      }
    }

    const git = createGit(run, dir, { remote: 'origin' })
    await git.view()
    const started = Date.now()
    const v = await git.view()
    const elapsed = Date.now() - started
    const payload = Buffer.byteLength(JSON.stringify(v), 'utf8') / 1024

    console.log(
      `${String(count).padStart(9)} | ${String(elapsed).padStart(7)} | ${payload.toFixed(0).padStart(10)} | ${String(v.files.length).padStart(12)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('')
console.log('Payload is what the poll sends to the browser every tick; every file')
console.log('object also becomes a React element during the render pass.')
