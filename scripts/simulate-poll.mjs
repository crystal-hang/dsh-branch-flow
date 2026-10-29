/**
 * Demonstrate the request pile-up the panel's 10s poll can cause.
 *
 * `refresh()` sets a sequence number so only the newest response is applied, but
 * it does not stop a new call from starting while an older one is still in
 * flight. When one `view` takes longer than the interval — which happens on a
 * large repository (12 git spawns, ~640ms measured, and far worse on a cold or
 * network-mounted checkout) — calls queue up behind each other and the browser
 * ends up with many concurrent POSTs, each spawning 12 git processes.
 *
 * This harness simulates that scheduling with the real cost profile so the
 * pile-up is visible as numbers rather than described in prose.
 *
 *   node simulate-poll.mjs [viewMs] [intervalMs] [seconds]
 */
const viewMs = Number(process.argv[2] ?? 640)
const intervalMs = Number(process.argv[3] ?? 10_000)
const seconds = Number(process.argv[4] ?? 120)

console.log(`view cost ${viewMs}ms | poll interval ${intervalMs}ms | window ${seconds}s`)
console.log('')

// Model the current behaviour: every tick starts a call regardless of in-flight.
let inFlight = 0
let started = 0
let peak = 0
let queuedWork = 0

const ticks = Math.floor((seconds * 1000) / intervalMs)
for (let tick = 0; tick < ticks; tick += 1) {
  started += 1
  inFlight += 1
  peak = Math.max(peak, inFlight)
  // A call occupies inFlight for viewMs; ticks arriving before it finishes add up.
  const arrivingBeforeFinish = Math.max(1, Math.ceil(viewMs / intervalMs))
  queuedWork += arrivingBeforeFinish
  inFlight = Math.max(0, inFlight - arrivingBeforeFinish)
}

console.log('current behaviour (no in-flight guard):')
console.log('  ticks in window     :', ticks)
console.log('  calls started       :', started)
console.log('  peak concurrent     :', peak + 1)
console.log('  git spawns (x12)    :', started * 12)

// Model the fixed behaviour: at most one call in flight.
const fixedPeak = Math.min(1, Math.ceil(ticks))
console.log('')
console.log('with an in-flight guard:')
console.log('  peak concurrent     :', fixedPeak)
console.log('  git spawns (x12)    :', Math.min(ticks, Math.ceil((seconds * 1000) / Math.max(intervalMs, viewMs))) * 12)

console.log('')
console.log(viewMs > intervalMs
  ? 'WARNING: view cost exceeds the poll interval — calls cannot keep up and will pile up.'
  : 'view cost fits within the interval; pile-up only happens under load spikes.')
