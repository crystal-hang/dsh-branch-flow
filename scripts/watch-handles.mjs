// Sample the DSH process tree's handle count while hammering /branch-flow/view.
// The point is to prove or disprove a per-request handle leak in the host, which
// a pure in-process soak test cannot see because it bypasses ctx.subprocess.
//
//   node watch-handles.mjs <repo> <iterations> <intervalMs>
const repo = process.argv[2]
const iterations = Number(process.argv[3] ?? 20)
const gap = Number(process.argv[4] ?? 0)
const port = process.env.DSH_PORT ?? '52520'
if (!repo) {
  console.error('usage: watch-handles.mjs <repo> [iterations] [gapMs]')
  process.exit(2)
}

const psScript = `
Get-Process | Where-Object { $_.ProcessName -match 'deepseek' } |
  ForEach-Object { "$($_.Id) $($_.HandleCount) $([math]::Round($_.WorkingSet64/1MB,0))" }
`
const { execFileSync } = await import('node:child_process')

function sample() {
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', psScript], { encoding: 'utf8' })
  const rows = new Map()
  for (const line of raw.split(/\r?\n/)) {
    const [pid, handles, ws] = line.trim().split(/\s+/)
    if (pid) rows.set(pid, { handles: Number(handles), ws: Number(ws) })
  }
  return rows
}

async function callView() {
  const response = await fetch(`http://127.0.0.1:${port}/branch-flow/view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo }),
  })
  return response.status
}

const before = sample()
console.log('before:', [...before.entries()].map(([p, v]) => `${p}:${v.handles}h/${v.ws}MB`).join(' '))

for (let i = 0; i < iterations; i += 1) {
  const status = await callView()
  if (status !== 200) { console.log('  status', status); break }
  if (gap > 0) await new Promise(r => setTimeout(r, gap))
}

await new Promise(r => setTimeout(r, 500))
const after = sample()
console.log('after :', [...after.entries()].map(([p, v]) => `${p}:${v.handles}h/${v.ws}MB`).join(' '))
console.log('')
console.log('per-process delta (handles / working set MB):')
for (const [pid, now] of after.entries()) {
  const was = before.get(pid) ?? { handles: 0, ws: 0 }
  console.log(`  ${pid}: ${now.handles - was.handles >= 0 ? '+' : ''}${now.handles - was.handles}h  ${now.ws - was.ws >= 0 ? '+' : ''}${now.ws - was.ws}MB`)
}
