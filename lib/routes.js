/**
 * The `/branch-flow/*` HTTP surface: one JSON envelope per verb, plus the
 * workspace trust fence. Every request must name a registered workspace root;
 * the browser can never run git against an arbitrary host directory.
 *
 * The fence is loopback-only (the desktop case). A LAN-exposed host answers
 * 403 unless another plugin's pairing service admits the client.
 * @module dsh-branch-flow/routes
 */

import { realpath } from 'node:fs/promises'
import { isLoopbackRequest } from './loopback.js'
import { GitOpError } from './git.js'

/** Default JSON body cap. */
const BODY_MAX_BYTES = 1 << 20

/** Paths a verb may name (rejects NUL bytes). */
function safePath(value) {
  return typeof value === 'string' && value !== '' && !value.includes('\0') ? value : null
}

/** Read a bounded JSON body; null on an empty or invalid payload. */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_MAX_BYTES) {
      req.destroy()
      return null
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** Write one JSON response. */
function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

/** The ok envelope. */
const ok = value => ({ ok: true, value })

/** The failure envelope, with a stable code for client-side copy. */
const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } })

/**
 * Whether this request may enter a route: loopback, or a live paired-device
 * cookie when a pairing service happens to be mounted.
 * @param {any} ctx
 * @param {import('node:http').IncomingMessage} req
 */
function allowed(ctx, req) {
  if (isLoopbackRequest(req)) return true
  const pairing = typeof ctx.get === 'function' ? ctx.get('remoteWebUiPairing', false) : undefined
  return typeof pairing?.isPairedDevice === 'function' && pairing.isPairedDevice(req) === true
}

/**
 * Register the routes.
 * @param {any} ctx - host context carrying webServer.
 * @param {object} deps
 * @param {(root: string) => Promise<object>} deps.gitFor - build a git service for one gated root.
 * @param {(root: string, input: object, signal: AbortSignal) => Promise<object>} deps.draftMessage
 * @param {() => object} deps.featureConfig - the live plugin config view.
 * @returns {() => void} the disposer.
 */
export function registerBranchFlowRoutes(ctx, deps) {
  /** Resolve and gate the workspace root a request names. */
  async function gate(rawPath) {
    const path = safePath(rawPath)
    if (path === null) return { ok: false, error: fail('bad-request', '缺少工作区路径') }
    let canonical
    try {
      canonical = await realpath(path)
    } catch {
      return { ok: false, error: fail('workspace-unknown', '该路径在磁盘上不存在') }
    }
    const workspaces = ctx.workspaceRegistry?.list?.() ?? []
    if (!workspaces.some(workspace => workspace.path === canonical)) {
      return { ok: false, error: fail('workspace-unknown', '该路径不是已注册的工作区') }
    }
    return { ok: true, root: canonical }
  }

  /** Run one verb with the shared error mapping. */
  async function invoke(res, root, run) {
    try {
      writeJson(res, 200, ok(await run()))
    } catch (error) {
      if (error instanceof GitOpError) {
        writeJson(res, 200, fail(error.code, error.message, { argv: error.argv }))
        return
      }
      if (error?.name === 'AbortError') {
        writeJson(res, 200, fail('aborted', '操作已取消'))
        return
      }
      ctx.logger?.warn?.(`branch-flow: ${String(error)}`)
      writeJson(res, 200, fail('internal', error instanceof Error ? error.message : String(error)))
    }
  }

  const handler = async (req, res) => {
    if (!allowed(ctx, req)) {
      writeJson(res, 403, fail('forbidden', 'loopback-only'))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      res.writeHead(415)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://x')
    const verb = url.pathname.replace(/^\/branch-flow\/?/, '').replace(/\/$/, '')
    const body = await readBody(req)
    if (body === null) {
      writeJson(res, 200, fail('bad-request', '请求体不是合法的 JSON'))
      return
    }

    if (verb === 'config') {
      writeJson(res, 200, ok(deps.featureConfig()))
      return
    }

    // Branch-name generation is pathless: the name comes from the description
    // alone, so it works even before a workspace is resolved.
    if (verb === 'suggest-branch-name') {
      const controller = new AbortController()
      req.on('close', () => { controller.abort(new Error('client closed')) })
      await invoke(res, '', () => deps.suggestBranchName(body, controller.signal))
      return
    }

    const gated = await gate(body.path)
    if (!gated.ok) {
      writeJson(res, 200, gated.error)
      return
    }
    const root = gated.root
    const git = deps.gitFor(root)
    const signal = new AbortController()
    req.on('close', () => { signal.abort(new Error('client closed')) })

    switch (verb) {
      case 'view':
        await invoke(res, root, () => git.view(signal.signal))
        return
      case 'fetch':
        await invoke(res, root, () => git.fetch(body, signal.signal))
        return
      case 'pull':
        await invoke(res, root, () => git.pull(body, signal.signal))
        return
      case 'commit':
        await invoke(res, root, () => git.commit(body, signal.signal))
        return
      case 'push':
        await invoke(res, root, () => git.push(body, signal.signal))
        return
      case 'merge':
        await invoke(res, root, () => git.mergeInto(body, signal.signal))
        return
      case 'merge-abort':
        await invoke(res, root, () => git.abortMerge(body, signal.signal))
        return
      case 'merge-continue':
        await invoke(res, root, () => git.continueMerge(body, signal.signal))
        return
      case 'create-branch':
        await invoke(res, root, () => git.createBranch(body, signal.signal))
        return
      case 'switch':
        await invoke(res, root, () => git.switchBranch(body, signal.signal))
        return
      case 'delete-branch':
        await invoke(res, root, () => git.deleteBranch(body, signal.signal))
        return
      case 'stage-plan': {
        await invoke(res, root, async () => {
          const view = await git.view(signal.signal)
          if (view === null) throw new GitOpError('not-a-repository', '当前目录不是 Git 仓库')
          const diff = await git.worktreeDiff(signal.signal)
          return {
            stage: view.stage,
            branch: view.branch,
            files: view.files,
            diff: diff.diff,
            untracked: diff.untracked,
          }
        })
        return
      }
      case 'draft-message':
        await invoke(res, root, () => deps.draftMessage(git, body, signal.signal))
        return
      default:
        res.writeHead(404)
        res.end()
    }
  }

  const disposePrefix = ctx.webServer.register({
    kind: 'prefix',
    path: '/branch-flow',
    handler,
  })

  return () => {
    disposePrefix()
  }
}
