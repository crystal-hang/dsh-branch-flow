/**
 * Read-only probe: print the panel view for one repository path, so the
 * baseline fallback fields can be checked without starting DSH.
 *
 *   node scripts/probe-view.mjs "D:\project\some-repo"
 */
import { execFileSync } from 'node:child_process'
import { createGit } from '../lib/git.js'

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node scripts/probe-view.mjs <repository-path>')
  process.exit(2)
}

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

const service = createGit(run, target, { remote: 'origin', baseline: 'production6', target: 'stage' })
const view = await service.view()
if (view === null) {
  console.log('not a git repository')
  process.exit(0)
}
console.log(JSON.stringify({
  root: view.root,
  branch: view.branch,
  dirty: view.dirtyFiles,
  untracked: view.untrackedFiles,
  conflicts: view.conflicts,
  ahead: view.ahead,
  behind: view.behind,
  baselineAvailable: view.baselineAvailable,
  baselineCandidates: view.baselineCandidates,
  stage: view.stage,
  branchCount: view.branches.length,
  stageExists: view.branches.some(item => item.name === 'stage'),
  productionExists: view.branches.some(item => item.name === 'production6'),
}, null, 2))
