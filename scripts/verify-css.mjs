/**
 * Static checks on the emitted stylesheet: every rule must be balanced, and the
 * dock strip must keep the host's composer geometry. Catches a broken selector
 * that a rendering harness alone would not notice.
 *
 *   node scripts/verify-css.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let failures = 0
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  }
}

const start = source.indexOf('const STYLE = [')
const end = source.indexOf("].join('", start)
check('stylesheet block is present', start !== -1 && end !== -1, `${start}/${end}`)

const block = source.slice(start, end)
// One rule per array line, each a single-quoted literal; comment lines and any
// prose containing an apostrophe are skipped by requiring a selector prefix.
const rules = []
for (const line of block.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith("'.")) continue
  const close = trimmed.lastIndexOf("'")
  if (close <= 0) continue
  rules.push(trimmed.slice(1, close))
}
check('stylesheet has rules', rules.length > 10, String(rules.length))

const unbalanced = rules.filter(rule => {
  const opens = (rule.match(/{/g) ?? []).length
  const closes = (rule.match(/}/g) ?? []).length
  return opens !== closes
})
check('every rule is balanced', unbalanced.length === 0, unbalanced.slice(0, 2).join(' | '))

const chip = rules.find(rule => rule.startsWith('.bf-chip{')) ?? ''

check('chip uses the tool-row height', chip.includes('height:28px'), chip)
check('chip is inline, not a block bar', chip.includes('display:inline-flex'), chip)
// Adaptive width: content-sized, capped relative to the viewport, and able to
// shrink inside the tool row. A hard small cap truncated legal branch names.
check('chip sizes to its content', chip.includes('flex:0 1 auto') && chip.includes('min-width:0'), chip)
check('chip cap fits a 50-character branch name', /max-width:min\(45vw,420px\)/.test(chip), chip)
check('chip has no short fixed cap', !/max-width:200px/.test(chip), chip)
check('chip name truncates only at the cap', (rules.find(rule => rule.startsWith('.bf-chip-name{')) ?? '').includes('text-overflow:ellipsis'))
// Design: a brand-tinted capsule. The border is transparent at rest so the
// tint carries the shape, and only the hover state reveals a brand edge.
check('chip has a brand-tinted surface', chip.includes('var(--dsw-alias-state-business-tertiary'), chip)
check('chip uses pill geometry', chip.includes('border-radius:999px'), chip)
check('chip keeps a transparent resting border for the hover edge', chip.includes('border:1px solid transparent'), chip)
check('chip hover mixes toward the brand colour', rules.some(rule => rule.startsWith('.bf-chip:hover') && rule.includes('color-mix(') && rule.includes('var(--dsw-alias-brand-primary)')))
check('chip hover lifts with a shadow', rules.some(rule => rule.startsWith('.bf-chip:hover') && rule.includes('box-shadow')))
check('chip animates its transitions', chip.includes('transition:'), chip)
check('chip has a visible focus ring', rules.some(rule => rule.startsWith('.bf-chip:focus-visible') && rule.includes('outline')))

const dot = rules.find(rule => rule.startsWith('.bf-chip-dot{')) ?? ''
check('state dot uses the success token', dot.includes('var(--dsw-alias-state-success-primary)'), dot)
check('warn dot uses the warn token', rules.some(rule => rule.includes('.bf-chip-dot.is-warn') && rule.includes('state-warn-primary')))
check('error dot uses the error token', rules.some(rule => rule.includes('.bf-chip-dot.is-error') && rule.includes('state-error-primary')))

// The old full-width dock strip must be gone, not merely unused.
check('no leftover dock strip rule', !rules.some(rule => rule.startsWith('.bf-dock{')))
check('no leftover bar rule', !rules.some(rule => rule.startsWith('.bf-bar{')))
check('panel rules survive the move', rules.some(rule => rule.startsWith('.bf-panel{')))

// ---------------------------------------------------------------- buttons
const button = rules.find(rule => rule.startsWith('.bf-btn{')) ?? ''
const primary = rules.find(rule => rule.startsWith('.bf-btn.primary{')) ?? ''
const danger = rules.find(rule => rule.startsWith('.bf-btn.danger{')) ?? ''

check('button uses pill geometry', button.includes('border-radius:999px'), button)
check('button animates its states', button.includes('transition:'), button)
check('button hover deepens its fill', rules.some(rule => rule.startsWith('.bf-btn:hover') && rule.includes('color-mix(')))
check('button has a focus ring', rules.some(rule => rule.startsWith('.bf-btn:focus-visible') && rule.includes('outline')))
check('disabled button is muted', rules.some(rule => rule.startsWith('.bf-btn:disabled') && rule.includes('cursor:not-allowed')), rules.find(rule => rule.startsWith('.bf-btn:disabled')) ?? 'missing')
// Primary is deliberately deep and low-saturation: the brand colour survives in
// the glow and focus ring, not as a bright block.
check('primary button is a deep gradient', primary.includes('linear-gradient(') && primary.includes('label-primary'), primary)
check('primary button carries a depth shadow', primary.includes('box-shadow'), primary)
check('primary button keeps the brand in its glow', rules.some(rule => rule.startsWith('.bf-btn.primary:hover') && rule.includes('var(--dsw-alias-brand-primary)')))
check('danger button stays quiet at rest', danger.includes('state-error-primary') && !danger.includes('color:#fff'), danger)
check('danger hover intensifies', rules.some(rule => rule.startsWith('.bf-btn.danger:hover') && rule.includes('color-mix(')))

// Long branch names must not stretch the merge row.
check('merge route renders as two pills', rules.some(rule => rule.startsWith('.bf-route-pill{')) && rules.some(rule => rule.startsWith('.bf-route-arrow{')))
check('route pills truncate independently', rules.some(rule => rule.startsWith('.bf-route-pill{') && rule.includes('text-overflow:ellipsis')))
check('target pill is tinted apart from the source', rules.some(rule => rule.startsWith('.bf-route-pill.is-target') && rule.includes('color-mix(')))
check('target select can shrink in its row', rules.some(rule => rule.startsWith('.bf-select-grow{') && rule.includes('min-width:0')))

// No literal palette should leak in: every colour must derive from a token.
// White and black are allowed only as color-mix partners (tints/shades of a
// token) and as the text colour on a saturated brand fill.
const stripColorMix = text => {
  let out = ''
  let depth = 0
  for (let at = 0; at < text.length; at += 1) {
    if (text.startsWith('color-mix(', at)) { depth += 1; at += 'color-mix('.length - 1; continue }
    if (depth > 0) {
      if (text[at] === '(') depth += 1
      else if (text[at] === ')') depth -= 1
      continue
    }
    out += text[at]
  }
  return out
}
const literalColours = rules.filter(rule => {
  const stripped = stripColorMix(rule).replace(/color:\s*#fff\b/g, '')
  return /#[0-9a-fA-F]{3,8}\b/.test(stripped)
})
check('no hard-coded palette beyond white-on-brand', literalColours.length === 0, literalColours.slice(0, 2).join(' | '))

// Inputs share the button surface language.
check('inputs and selects animate focus', rules.some(rule => rule.startsWith('.bf-input:focus') && rule.includes('box-shadow')))
check('inputs use the brand focus colour', rules.some(rule => rule.startsWith('.bf-input:focus') && rule.includes('var(--dsw-alias-brand-primary)')))
// iOS-style fields: native chrome removed, filled surface, soft inner shadow.
const field = rules.find(rule => rule.startsWith('.bf-input,.bf-select{')) ?? ''
check('fields drop the native control chrome', field.includes('appearance:none'), field)
check('fields are a flat fill, not a bordered box', field.includes('border:1px solid transparent'), field)
check('fields use a generous radius', field.includes('border-radius:10px'), field)
check('fields carry a soft inner shadow', field.includes('inset 0 1px 2px'), field)
check('select gets a custom chevron', rules.some(rule => rule.startsWith('.bf-select{') && rule.includes('background-image')))
check('select keeps room for the chevron', rules.some(rule => rule.startsWith('.bf-select{') && /padding-right:3\dpx/.test(rule)))
// The `background` shorthand resets background-image and would erase the
// chevron, letting the native arrow reappear. Fills must use background-color.
check('field fills avoid the background shorthand', !/(^|;)background:(?!\s*c)/.test(field), field)
// The OS draws the popup list; without an explicit surface it flashes dark.
check('select options declare their own surface', rules.some(rule => rule.startsWith('.bf-select option{') && rule.includes('background-color')))
check('search field matches the iOS fill', rules.some(rule => rule.startsWith('.bf-search{') && rule.includes('inset 0 1px 2px')))
check('search focus grows a ring, not a border', rules.some(rule => rule.startsWith('.bf-search:focus-within') && rule.includes('box-shadow')))
check('notices tint by state', rules.some(rule => rule.startsWith('.bf-notice.ok') && rule.includes('color-mix(')))
check('panel sheet rises into place', block.includes('@keyframes bf-rise'))
check('panel respects reduced motion', block.includes('prefers-reduced-motion'))

console.log(failures === 0 ? '\nALL CSS CHECKS PASSED' : `\n${failures} CSS CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
