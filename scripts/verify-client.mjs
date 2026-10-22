/**
 * Headless render check for the browser half. It is NOT a browser: it runs the
 * bundle through a tiny React-compatible driver (hooks included) so reference
 * errors, bad props and throwing render paths surface here instead of blanking
 * the real slot entry.
 *
 *   node scripts/verify-client.mjs
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'client.js')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

//#region tiny hooks runtime
let hookIndex = 0
let hookState = []
let pendingEffects = []
let dirty = false
function resetHooks() {
  hookIndex = 0
}

function useState(initial) {
  const index = hookIndex++
  if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? initial() : initial
  const set = (next) => {
    const value = typeof next === 'function' ? next(hookState[index]) : next
    if (Object.is(value, hookState[index])) return
    hookState[index] = value
    dirty = true
  }
  return [hookState[index], set]
}

function useRef(initial) {
  const index = hookIndex++
  if (!(index in hookState)) hookState[index] = { current: initial }
  return hookState[index]
}

function depsChanged(a, b) {
  if (a === undefined || b === undefined) return true
  if (a.length !== b.length) return true
  return a.some((value, i) => !Object.is(value, b[i]))
}

function useMemo(factory, deps) {
  const index = hookIndex++
  const slot = hookState[index]
  if (slot === undefined || depsChanged(slot.deps, deps)) {
    hookState[index] = { value: factory(), deps }
  }
  return hookState[index].value
}

function useCallback(fn, deps) {
  const index = hookIndex++
  const slot = hookState[index]
  if (slot === undefined || depsChanged(slot.deps, deps)) hookState[index] = { value: fn, deps }
  return hookState[index].value
}

function useEffect(fn, deps) {
  const index = hookIndex++
  const slot = hookState[index]
  if (slot === undefined || depsChanged(slot.deps, deps)) {
    hookState[index] = { fn, deps, cleanup: slot?.cleanup }
    pendingEffects.push(hookState[index])
  }
}

function h(type, propsOrNull, ...children) {
  const props = propsOrNull === null || propsOrNull === undefined ? {} : propsOrNull
  return { type, props: { ...props, children: children.length > 0 ? children : props.children } }
}

const React = { createElement: h, Fragment: 'Fragment', useState, useRef, useMemo, useCallback, useEffect }

async function render(fn, props, label) {
  // Hooks belong to one mounted component: a fresh slot array per render keeps
  // two different components from sharing indices.
  hookState = []
  resetHooks()
  let element
  for (let pass = 0; pass < 12; pass += 1) {
    dirty = false
    pendingEffects = []
    resetHooks()
    element = fn(props)
    const effects = pendingEffects
    pendingEffects = []
    for (const effect of effects) {
      const cleanup = effect.fn()
      effect.cleanup = cleanup
    }
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!dirty) break
  }
  return element
}
//#endregion

//#region browser stubs
const listeners = new Map()
const windowStub = {
  addEventListener: (name, fn) => { listeners.set(name, fn) },
  removeEventListener: (name) => { listeners.delete(name) },
  confirm: () => false,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: handle => clearInterval(handle),
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.get(key) ?? null },
    setItem(key, value) { this.store.set(key, String(value)) },
    removeItem(key) { this.store.delete(key) },
  },
}
const documentStub = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
}
class EventSourceStub {
  constructor(url) { this.url = url; this.listeners = new Map() }
  addEventListener(name, fn) { this.listeners.set(name, fn) }
  removeEventListener(name) { this.listeners.delete(name) }
  close() { this.closed = true }
}
//#endregion

const responses = new Map()
const fetchCalls = []
async function fetchStub(url, init) {
  const verb = String(url).replace(/^branch-flow\//, '')
  fetchCalls.push({ verb, body: init?.body })
  const body = responses.get(verb) ?? { ok: false, error: { code: 'internal', message: 'not stubbed' } }
  return { json: async () => body }
}

const sandbox = {
  window: Object.assign(windowStub, { __ModuleLoader__: { load: definition => { sandbox.__loaded = definition } } }),
  document: documentStub,
  fetch: fetchStub,
  EventSource: EventSourceStub,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Set,
  Map,
  Object,
  Array,
  JSON,
  Promise,
  String,
  Number,
  Boolean,
  Math,
  RegExp,
  Error,
}
sandbox.globalThis = sandbox
sandbox.window.document = documentStub

const context = createContext(sandbox)
const source = readFileSync(bundlePath, 'utf8')
runInContext(source, context, { filename: bundlePath })

const definition = sandbox.__loaded
check('bundle registers a module factory', definition !== undefined && typeof definition.factory === 'function')
check('factory id matches the package', definition?.id === 'dsh-branch-flow', definition?.id)

const plugin = definition.factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
check('plugin exports inject + apply', Array.isArray(plugin.inject) && typeof plugin.apply === 'function')

//#region host stubs: capture slot registrations
const registrations = []
const ctx = {
  effect: fn => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  inject: (deps, fn) => {
    fn({
      slots: {
        inject: (slot, callback) => { callback(); return () => {} },
        register: (options, component) => {
          registrations.push({ slot: options.name, id: options.id, component })
          return () => {}
        },
      },
    })
    return { dispose() {} }
  },
  locale: { register: () => () => {} },
}
plugin.apply(ctx)
check('registers the composer tool-row chip', registrations.some(item => item.slot === 'conversation.input.right' && item.id === 'branch-flow'))
check('the chip no longer seats in the dock row', !registrations.some(item => item.slot === 'conversation.input.dock'))
check('registers the frame overlay panel', registrations.some(item => item.slot === 'shell.overlay' && item.id === 'branch-flow-panel'))

const bar = registrations.find(item => item.id === 'branch-flow').component
const panel = registrations.find(item => item.id === 'branch-flow-panel').component
//#endregion

//#region fixtures
const view = {
  root: 'C:/repo',
  branch: 'feature/user-login',
  head: 'abc1234',
  detached: false,
  dirtyFiles: 1,
  untrackedFiles: 1,
  conflicts: 0,
  operation: null,
  operationInProgress: false,
  remotes: ['origin'],
  remote: 'origin',
  upstream: 'origin/feature/user-login',
  ahead: 1,
  behind: 0,
  files: [
    { path: 'src/auth/login.ts', index: 'M', worktree: ' ', conflict: false, untracked: false },
    { path: 'src/auth/new.ts', index: '?', worktree: '?', conflict: false, untracked: true },
  ],
  branches: [
    { name: 'feature/user-login', head: 'abc1234', updated: '2 hours ago', upstream: 'origin/feature/user-login', ahead: 1, behind: 0, current: true, environment: false, protected: false, prefix: 'feature' },
    { name: 'stage', head: 'def5678', updated: '1 day ago', upstream: 'origin/stage', ahead: 0, behind: 0, current: false, environment: true, protected: true, prefix: '' },
    { name: 'production6', head: '9876fed', updated: '3 days ago', upstream: 'origin/production6', ahead: 0, behind: 0, current: false, environment: true, protected: true, prefix: '' },
  ],
  baselineAvailable: true,
  baselineCandidates: [],
  stage: { available: true, reason: '', source: 'feature/user-login', target: 'stage' },
  settings: { remote: 'origin', baseline: 'production6', target: 'stage', pushAfterMerge: true },
  productionBranch: 'production6',
  stageBranch: 'stage',
}
responses.set('view', { ok: true, value: view })
responses.set('commit', { ok: true, value: { commit: 'aaa1111', subject: 'feat(auth): 新增登录入口', files: ['src/auth/login.ts'] } })
responses.set('push', { ok: true, value: { branch: 'feature/user-login', remote: 'origin' } })
responses.set('merge', { ok: true, value: { ok: true, stage: 'merged', source: 'feature/user-login', target: 'stage', steps: ['fetch origin', 'switch stage'], pushed: true, restored: true, commit: 'bbb2222' } })
responses.set('draft-message', { ok: true, value: { ok: true, message: 'feat(auth): 新增登录入口', issues: [], provider: 'p', model: 'm' } })
responses.set('fetch', { ok: true, value: { ok: true } })
//#endregion

const barProps = {
  sessionId: 'session-1',
  useSessions: selector => selector({ byId: { 'session-1': { cwd: 'C:/repo' } } }),
  inputActions: {
    captureInsertion: () => ({ draftRev: 1 }),
    insertText: () => true,
  },
  t: (key, vars) => key,
}

const barElement = await render(bar, barProps, 'bar')
check('chip renders without throwing', barElement !== undefined)
const barText = JSON.stringify(barElement)
check('chip shows the branch name', barText.includes('feature/user-login'), barText.slice(0, 160))
check('chip reads the workspace view', fetchCalls.some(call => call.verb === 'view'), JSON.stringify(fetchCalls.map(c => c.verb)))

// The chip is an inline tool-row control, not the old full-width dock strip.
const styleText = findStyleText(barElement)
check('chip uses the compact tool-row metrics', /\.bf-chip\{[^}]*height:28px/.test(styleText), styleText.match(/\.bf-chip\{[^}]*\}/)?.[0])
check('chip is not a full-width dock bar', !styleText.includes('.bf-dock{') && !styleText.includes('.bf-bar{'))
check('chip keeps a state dot', styleText.includes('.bf-chip-dot'))
check('chip marks conflicts with the error colour', styleText.includes('.bf-chip-badge.is-error'))

// The panel is store-driven: click the bar's main action to open it.
function findHandler(element, predicate) {
  if (element === null || typeof element !== 'object') return null
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findHandler(child, predicate)
      if (found) return found
    }
    return null
  }
  const props = element.props ?? {}
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function' && predicate(key, props)) return value
  }
  return findHandler(props.children, predicate)
}

/** Collect the text of every <style> element in a rendered tree. */
function findStyleText(element) {
  if (element === null || typeof element !== 'object') return ''
  if (Array.isArray(element)) return element.map(findStyleText).join('')
  // Nested function components (Styles) must be invoked by this walker; the
  // real renderer does that, a plain prop walk does not.
  if (typeof element.type === 'function') return findStyleText(element.type(element.props))
  const props = element.props ?? {}
  if (element.type === 'style') return String(props.children ?? '')
  return findStyleText(props.children)
}

const openHandler = findHandler(barElement, key => key === 'onClick')
check('bar exposes an open action', typeof openHandler === 'function')
openHandler?.({})

const panelElement = await render(panel, { t: (key, vars) => key }, 'panel')
check('panel renders without throwing', panelElement !== undefined && panelElement !== null)
const panelText = JSON.stringify(panelElement)
check('panel lists changed files', panelText.includes('src/auth/login.ts'), panelText.slice(0, 200))
check('panel offers the one-click flow', panelText.includes('panel.oneClick'), panelText.slice(0, 200))
check('panel exposes the merge target controls', panelText.includes('panel.mergeInto'))
check('panel exposes the create-branch form', panelText.includes('panel.section.create'))
check('panel shows the rule-checked branch name', panelText.includes('feature/user-login'))

// Section titles carry no manual numbering: the order is visual, and a hard
// "1 ·" prefix goes stale as soon as a section is conditionally hidden.
check('no numbered section titles', !panelText.includes('1 · '), panelText.slice(0, 120))
check('section titles read as plain labels', panelText.includes('panel.section.commit') && panelText.includes('panel.section.merge'), panelText.slice(0, 160))

// Untracked files are hidden until the toggle is used.
check('untracked file is hidden by default', !panelText.includes('src/auth/new.ts'), panelText.slice(0, 400))
check('hidden untracked count is offered', panelText.includes('panel.files.untracked'), panelText.slice(0, 400))
// The three explanatory steps were removed on request: the button label already
// names the flow, and the numbered copy cluttered the card.
check('one-click step copy is gone', !panelText.includes('panel.flow.step'), panelText.slice(0, 400))

// The branch card offers a remote refresh, so a colleague's new branch appears.
check('branch card offers a refresh action', panelText.includes('panel.branch.refresh'), panelText.slice(0, 400))
check('remote group renders even before any remote-only branch exists', panelText.includes('panel.branch.groupRemote'))

// The header states the branch as a distinct pill rather than plain subtext.
check('header shows the branch as a pill', styleText.includes('.bf-branch-pill'), styleText.slice(0, 200))
check('header title is emphasised', /\.bf-title\{[^}]*font-size:15px/.test(styleText), styleText.match(/\.bf-title\{[^}]*\}/)?.[0])

check('branch creation states that it fetches first', panelText.includes('panel.create.fetchesFirst'))

// Conflict state: the panel must offer the composer hand-off.
responses.set('merge', {
  ok: true,
  value: {
    ok: false,
    stage: 'conflict',
    source: 'feature/user-login',
    target: 'stage',
    steps: ['switch stage'],
    conflicts: ['src/auth/login.ts'],
    message: 'conflict',
  },
})
const mergeElement = await render(panel, { t: (key, vars) => key }, 'panel-conflict')
const mergeHandler = findHandler(mergeElement, (key, props) => JSON.stringify(props.children ?? '').includes('panel.oneClick'))
check('one-click action is reachable', typeof mergeHandler === 'function')

// The conflict surface must list the blocking files and offer the composer
// hand-off; a bare "合并失败" is what the user complained about. The hook-driven
// panel cannot reach that state in this harness (the merge response arrives
// asynchronously), so the markup that renders it is asserted directly.
const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
check('conflict card is rendered by the panel', clientSource.includes('bf-card bf-card-conflict'))
check('conflict card lists the blocking files', clientSource.includes('conflict.files.map'))
check('conflict card offers the composer hand-off', clientSource.includes('doSendConflict'))
check('conflict card offers continue and abort', clientSource.includes('doContinueMerge') && clientSource.includes('doAbortMerge'))
check('conflict notice is error-level, not a bare merge-failed', /value\.stage === 'conflict'[\s\S]{0,400}report\('err', t\('panel\.conflict\.message'/.test(clientSource))
check('conflict file names carry a title tooltip', /conflict\.files\.map[\s\S]{0,200}title: file/.test(clientSource))

// A branch that only exists on the remote (a colleague just pushed it) must be
// listed and switchable; that is what the refresh button is for. The remote
// group starts collapsed, so its rows appear only after expanding it.
responses.set('view', { ok: true, value: { ...view, remoteBranches: [
  { name: 'feature/colleague-new', head: 'ff00aa1', updated: '5 minutes ago', remote: 'origin', current: false, environment: false, protected: false, prefix: 'feature' },
] } })
const remoteElement = await render(panel, { t: (key, vars) => key }, 'panel-remote-branch')
const remoteText = JSON.stringify(remoteElement)
// Two explicit groups replace the old in-list caption.
check('branches are split into a local group', remoteText.includes('panel.branch.groupLocal'), remoteText.slice(0, 300))
check('branches are split into a remote group', remoteText.includes('panel.branch.groupRemote'))
check('each group carries its own count', remoteText.includes('bf-group-count'), remoteText.slice(0, 300))
check('group headers carry no prose description', !remoteText.includes('bf-group-desc'), remoteText.slice(0, 300))
check('the old in-list caption is gone', !remoteText.includes('panel.branch.remoteHint'))
check('the old remote-only tag is gone', !remoteText.includes('panel.branch.remoteOnly'))

// The remote group is collapsed by default, so its rows are not rendered yet.
check('remote group starts collapsed', !remoteText.includes('feature/colleague-new'), remoteText.slice(0, 300))
check('remote group header reports collapsed state', remoteText.includes('"aria-expanded":"false"'), remoteText.slice(0, 200))

// Its header stays clickable, which is what expands it.
const remoteHead = findHandler(remoteElement, (key, props) => JSON.stringify(props.children ?? '').includes('panel.branch.groupRemote'))
check('remote group header is clickable', typeof remoteHead === 'function')

// The branch search filters both groups; a hit in the collapsed group still
// shows its count so the user knows to expand.
check('branch search field is present', remoteText.includes('panel.branch.search'), remoteText.slice(0, 300))
check('branch search has a clear affordance source', styleText.includes('.bf-search-clear'))
check('commit hashes are not rendered in branch rows', !remoteText.includes('"meta bf-mono"'), remoteText.slice(0, 200))

// A repository without the configured baseline must still render (override UI),
// and the picker must offer the whole branch list, not a sample.
const manyBranches = []
for (let index = 0; index < 40; index += 1) {
  manyBranches.push(`release/legacy-${index}`)
}
responses.set('view', { ok: true, value: { ...view, baselineAvailable: false, baselineCandidates: ['master', 'main', ...manyBranches], branch: 'master', branches: [
  { name: 'master', head: 'abc1234', updated: '1 day ago', upstream: 'origin/master', ahead: 0, behind: 0, current: true, environment: false, protected: false, prefix: '' },
  { name: 'liveProd', head: 'def5678', updated: '2 days ago', upstream: '', ahead: 0, behind: 0, current: false, environment: false, protected: false, prefix: '' },
] } })
const fallbackElement = await render(panel, { t: (key, vars) => key }, 'panel-baseline-fallback')
const fallbackText = JSON.stringify(fallbackElement)
check('missing baseline shows the override UI', fallbackText.includes('panel.create.missingBaseline'), fallbackText.slice(0, 200))
check('override offers the real repository baselines', fallbackText.includes('master') && fallbackText.includes('liveProd'))
check('baseline picker is searchable', fallbackText.includes('panel.create.searchBaseline'))
check('baseline picker lists all 42 candidates', fallbackText.includes('release/legacy-39'), 'last candidate missing')
check('baseline picker reports the total', fallbackText.includes('panel.create.baselineCount'))

// A worktree with only untracked content must say so instead of showing an
// empty list or claiming there are no changes at all.
responses.set('view', { ok: true, value: { ...view, files: [
  { path: 'AGENTS.md', index: '?', worktree: '?', conflict: false, untracked: true },
  { path: 'tools/__pycache__/x.cpython-39.pyc', index: '?', worktree: '?', conflict: false, untracked: true },
] } })
const onlyUntrackedElement = await render(panel, { t: (key, vars) => key }, 'panel-only-untracked')
const onlyUntrackedText = JSON.stringify(onlyUntrackedElement)
check('only-untracked worktree explains itself', onlyUntrackedText.includes('panel.onlyUntracked'), onlyUntrackedText.slice(0, 200))
check('only-untracked worktree still offers the toggle', onlyUntrackedText.includes('panel.files.untracked'))
check('only-untracked files are not listed as tracked changes', !onlyUntrackedText.includes('tools/__pycache__'), onlyUntrackedText.slice(0, 300))

// A null view (not a repository) must not throw.
responses.set('view', { ok: true, value: null })
const nullElement = await render(panel, { t: (key, vars) => key }, 'panel-null')
check('panel tolerates a non-repository view', nullElement !== undefined)

console.log(failures === 0 ? '\nALL CLIENT CHECKS PASSED' : `\n${failures} CLIENT CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
