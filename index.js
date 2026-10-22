/**
 * Host half of the branch-flow bundle: the `/branch-flow/*` routes over the
 * managed subprocess service, plus the workspace-gated git verbs they expose.
 *
 * No model-visible tool is registered on purpose: every action is driven by
 * the panel in the composer dock. The one model interaction the panel offers
 * is `draft-message`, which the host serves over the `llm` service on the
 * panel's own request.
 * @module dsh-branch-flow
 */

import { createGit, gitRunner } from './lib/git.js'
import { createMessageDrafter } from './lib/message.js'
import { createBranchNameDrafter } from './lib/branch-name.js'
import { registerBranchFlowRoutes } from './lib/routes.js'

/** Services this plugin needs; the tools surface is deliberately absent. */
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

/**
 * Defaults for the flow. A profile's patch layer may override any of them in
 * the row's `config`; unknown or missing fields fall back here, so the plugin
 * never fails to mount because of a partial config.
 */
const DEFAULTS = {
  baseline: 'production6',
  target: 'stage',
  remote: 'origin',
  pushAfterMerge: true,
}

/** Resolve one config value, preferring the live row value when present. */
function read(config, key) {
  const value = config?.[key]
  if (value === undefined || value === null) return DEFAULTS[key]
  if (typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/** Resolve the effective config, defaults applied. */
function effectiveConfig(config) {
  return {
    baseline: String(read(config, 'baseline')),
    target: String(read(config, 'target')),
    remote: String(read(config, 'remote')),
    pushAfterMerge: read(config, 'pushAfterMerge') !== false,
  }
}

/**
 * Mount the routes.
 * @param {any} ctx - context carrying webServer, subprocess, workspaceRegistry.
 * @param {any} [config] - the row's config as the Host resolved it.
 */
export function apply(ctx, config) {
  const run = gitRunner(ctx)

  /** Build a git service for one gated root using the live settings. */
  const gitFor = root => {
    const active = effectiveConfig(config)
    return createGit(run, root, {
      remote: active.remote,
      baseline: active.baseline,
      target: active.target,
      pushAfterMerge: active.pushAfterMerge,
    })
  }

  /** Fallback model selection when no default-model service answers. */
  const fallbackModel = () => {
    const service = ctx.get?.('agentDefaultModel')
    const selection = service?.currentSelection?.()
    return selection === undefined || selection === null
      ? null
      : { provider: selection.provider, model: selection.model }
  }
  const draft = createMessageDrafter(ctx, async () => fallbackModel())
  const draftBranchName = createBranchNameDrafter(ctx, async () => fallbackModel())

  const draftMessage = async (git, input, signal) => {
    const view = await git.view(signal)
    if (view === null) {
      return { ok: false, error: '当前目录不是 Git 仓库', issues: [] }
    }
    const worktree = await git.worktreeDiff(signal)
    const files = view.files.map(file => file.path)
    const result = await draft({
      diff: worktree.diff,
      files,
      branch: view.branch,
      subject: typeof input?.subject === 'string' ? input.subject : '',
    }, signal)
    return result
  }

  /**
   * Propose a branch name for a plain-language requirement. No repository access
   * is needed: the name is derived from the description and then validated by the
   * same rules the create form uses.
   */
  const suggestBranchName = async (input, signal) => draftBranchName({
    description: typeof input?.description === 'string' ? input.description : '',
    prefix: typeof input?.prefix === 'string' ? input.prefix : undefined,
  }, signal)

  const featureConfig = () => {
    const active = effectiveConfig(config)
    return {
      baseline: active.baseline,
      target: active.target,
      remote: active.remote,
      pushAfterMerge: active.pushAfterMerge,
      commitTypes: ['feat', 'fix', 'refactor', 'perf', 'docs', 'style', 'test', 'build', 'ci', 'chore', 'revert'],
      prefixes: ['feature', 'bugfix', 'hotfix', 'release'],
      maxBranchLength: 50,
      maxSubjectLength: 72,
    }
  }

  ctx.effect(
    () => registerBranchFlowRoutes(ctx, { gitFor, draftMessage, suggestBranchName, featureConfig }),
    'dsh-branch-flow: /branch-flow routes',
  )
}
