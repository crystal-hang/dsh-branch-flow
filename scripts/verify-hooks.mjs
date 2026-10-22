/**
 * Hook-order check for the browser half.
 *
 * React requires the same hooks in the same order on every render. An early
 * `return` placed before a hook changes the hook count between the closed and
 * open states, so instead of opening, the panel is unmounted by React and the
 * dock entry silently goes inactive (the "click does nothing" symptom).
 *
 * This check reads each component in client.js and fails when any hook call
 * appears after an early return inside that component.
 *
 *   node scripts/verify-hooks.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
const lines = source.split('\n')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

/**
 * Walk one component and report, per line, the brace depth relative to the
 * component body (1 = directly inside the component, 2+ = inside a nested
 * callback). Braces inside string literals are ignored.
 * @param {number} start - index of the `function X(` line.
 * @returns {{ end: number, depthByLine: Map<number, number> } | null}
 */
function scanBody(start) {
  const depthByLine = new Map()
  let depth = 0
  let opened = false
  let quote = null
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]
    depthByLine.set(index, depth)
    for (let at = 0; at < line.length; at += 1) {
      const character = line[at]
      if (quote !== null) {
        if (character === '\\') at += 1
        else if (character === quote) quote = null
        continue
      }
      if (character === "'" || character === '"' || character === '`') { quote = character; continue }
      if (character === '/' && line[at + 1] === '/') break
      if (character === '{') { depth += 1; opened = true }
      else if (character === '}') depth -= 1
    }
    // A line's recorded depth is the depth at its start, except the opening
    // line itself, which enters the body on that line.
    if (index === start) depthByLine.set(index, 1)
    if (opened && depth === 0) return { end: index, depthByLine }
  }
  return null
}

/** Locate a top-level component by its declaration line. */
function componentRange(name) {
  const start = lines.findIndex(line => line.includes(`function ${name}(`))
  if (start === -1) return null
  const body = scanBody(start)
  return body === null ? null : { start, ...body }
}

const HOOK = /\b(useState|useEffect|useMemo|useCallback|useRef)\s*\(/
const EARLY_RETURN = /^\s*if\s*\([^)]*\)\s*return\b/

for (const name of ['BranchBar', 'BranchPanel']) {
  const range = componentRange(name)
  check(`${name} is present`, range !== null)
  if (range === null) continue

  const body = lines.slice(range.start, range.end + 1)
  // Only a return directly inside the component (depth 1) shortens its hook
  // list; a return inside a callback or effect body is scoped to that function.
  const firstReturn = body.findIndex((line, offset) => {
    const depth = range.depthByLine.get(range.start + offset)
    return depth === 1 && EARLY_RETURN.test(line)
  })
  const hooksAfter = firstReturn === -1
    ? []
    : body
        .slice(firstReturn)
        .map((line, offset) => ({ line, at: range.start + firstReturn + offset + 1 }))
        .filter(item => HOOK.test(item.line))

  check(
    `${name} calls no hook after a top-level early return`,
    hooksAfter.length === 0,
    hooksAfter.map(item => `line ${item.at}: ${item.line.trim()}`).join(' | '),
  )

  const hookCount = body.filter(line => HOOK.test(line)).length
  check(`${name} uses hooks`, hookCount > 0, String(hookCount))
}

// The panel must return null (not throw) when the store says closed, and the
// marker it returns on still has to sit after every hook.
const panelRange = componentRange('BranchPanel')
if (panelRange !== null) {
  const body = lines.slice(panelRange.start, panelRange.end + 1)
  const nullReturn = body.findIndex(line => /if \(!open\) return null/.test(line))
  check('panel keeps its closed-state return', nullReturn !== -1)
  if (nullReturn !== -1) {
    const after = body.slice(nullReturn + 1).filter(line => HOOK.test(line))
    check('no hook follows the closed-state return', after.length === 0, after.map(line => line.trim()).join(' | '))
  }
}

console.log(failures === 0 ? '\nALL HOOK CHECKS PASSED' : `\n${failures} HOOK CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
