/**
 * Check the v2 status parser against real `git status` output.
 *
 * `view()` used to spend four separate git processes just to learn the branch,
 * the commit, the upstream and the ahead/behind distance, and a fifth to list
 * files. All of that is in `status --porcelain=v2 --branch`, but only if the row
 * layout is unpacked correctly — the unmerged and rename rows carry a different
 * field count, which is exactly where a naive `slice(3)` breaks.
 *
 * This harness builds the states that matter in a throwaway repository, runs
 * the real command, and asserts the parser's reading of it.
 *
 *   node scripts/verify-status-parser.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseStatus } from '../lib/git.js'

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const dir = mkdtempSync(join(tmpdir(), 'bf-status-'))
try {
  git(dir, ['init', '-q', '-b', 'master'])
  git(dir, ['config', 'user.email', 'a@b.c'])
  git(dir, ['config', 'user.name', 'a'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  writeFileSync(join(dir, 'b.txt'), 'one\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'c1'])

  const status = (extra = []) => parseStatus(git(dir, ['status', '--porcelain=v2', '--branch', ...extra]))

  console.log('clean tree')
  {
    const parsed = status()
    check('branch name', parsed.branch === 'master', parsed.branch)
    check('head is a short oid', /^[0-9a-f]{9}$/.test(parsed.head), parsed.head)
    check('no files', parsed.files.length === 0, JSON.stringify(parsed.files))
    check('no dirt', parsed.dirtyFiles === 0 && parsed.untrackedFiles === 0)
    check('no upstream yet', parsed.upstream === '', parsed.upstream)
  }

  console.log('modified file')
  {
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    const parsed = status()
    const row = parsed.files.find(f => f.path === 'a.txt')
    check('row present', row !== undefined, JSON.stringify(parsed.files))
    check('row is not untracked', row?.untracked === false)
    check('worktree flag is M', row?.worktree === 'M', row?.worktree)
    check('dirtyFiles counts it', parsed.dirtyFiles === 1, parsed.dirtyFiles)
    git(dir, ['checkout', '--', 'a.txt'])
  }

  console.log('staged rename')
  {
    git(dir, ['mv', 'b.txt', 'renamed.txt'])
    const parsed = status()
    const row = parsed.files.find(f => f.path === 'renamed.txt')
    check('rename resolves to destination', row !== undefined, JSON.stringify(parsed.files))
    check('rename is not treated as untracked', row?.untracked === false)
    git(dir, ['reset', '-q', '--hard'])
  }

  console.log('untracked directory is collapsed')
  {
    mkdirSync(join(dir, 'build', 'deep', 'deeper'), { recursive: true })
    for (let i = 0; i < 40; i += 1) {
      writeFileSync(join(dir, 'build', 'deep', 'deeper', `f${i}.js`), 'x')
    }
    const parsed = status(['--untracked-files=normal'])
    check('one row for the whole tree', parsed.files.length === 1, JSON.stringify(parsed.files.map(f => f.path)))
    check('row path is the directory', parsed.files[0]?.path === 'build/', parsed.files[0]?.path)
    check('untracked row flagged', parsed.files[0]?.untracked === true)
    check('untrackedFiles counts 1', parsed.untrackedFiles === 1, parsed.untrackedFiles)

    const all = status(['--untracked-files=all'])
    check('`-uall` still expands', all.files.length === 40, all.files.length)
    rmSync(join(dir, 'build'), { recursive: true, force: true })
  }

  console.log('ahead / behind')
  {
    const bare = mkdtempSync(join(tmpdir(), 'bf-status-remote-'))
    try {
      git(bare, ['init', '-q', '--bare'])
      git(dir, ['remote', 'add', 'origin', bare])
      git(dir, ['push', '-q', '-u', 'origin', 'master'])
      const clean = status()
      check('upstream reported', clean.upstream === 'origin/master', clean.upstream)
      check('in sync reads 0/0', clean.ahead === 0 && clean.behind === 0, `${clean.ahead}/${clean.behind}`)

      writeFileSync(join(dir, 'ahead.txt'), 'x\n')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-q', '-m', 'c2'])
      const ahead = status()
      check('ahead counts 1', ahead.ahead === 1, ahead.ahead)
      check('behind stays 0', ahead.behind === 0, ahead.behind)

      // A commit that exists only on the remote side makes the branch diverge.
      const other = mkdtempSync(join(tmpdir(), 'bf-status-other-'))
      try {
        git(other, ['clone', '-q', bare, '.'])
        git(other, ['config', 'user.email', 'a@b.c'])
        git(other, ['config', 'user.name', 'a'])
        writeFileSync(join(other, 'other.txt'), 'y\n')
        git(other, ['add', '.'])
        git(other, ['commit', '-q', '-m', 'c3'])
        git(other, ['push', '-q', 'origin', 'master'])
      } finally {
        rmSync(other, { recursive: true, force: true })
      }
      git(dir, ['fetch', '-q', 'origin'])
      const diverged = status()
      check('diverged reads 1/1', diverged.ahead === 1 && diverged.behind === 1, `${diverged.ahead}/${diverged.behind}`)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  }

  console.log('conflict rows')
  {
    git(dir, ['checkout', '-q', '-b', 'side', 'HEAD~1'])
    writeFileSync(join(dir, 'a.txt'), 'side\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'side'])
    git(dir, ['checkout', '-q', 'master'])
    writeFileSync(join(dir, 'a.txt'), 'master\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', 'master'])
    try { git(dir, ['merge', 'side']) } catch { /* the conflict is the point */ }
    const parsed = status()
    check('conflict counted', parsed.conflicts === 1, parsed.conflicts)
    const row = parsed.files.find(f => f.path === 'a.txt')
    check('unmerged row present', row !== undefined, JSON.stringify(parsed.files))
    check('unmerged row flagged conflict', row?.conflict === true, JSON.stringify(row))
    check('unmerged row path is exact', row?.path === 'a.txt', row?.path)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('')
console.log(failures === 0 ? 'all status-parser checks passed' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
