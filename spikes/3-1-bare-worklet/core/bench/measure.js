// Measure on Bare: start-up time, RSS at idle and after 10,000 appended events, CPU (rough),
// bytes on disk, bytes replicated (estimated). Run each 3 times; give median and spread.
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const fs = require('bare-fs')
const path = require('bare-path')
const os = require('bare-os')
const b4a = require('b4a')
const { createSpace } = require('../lib/space')
const { makeEvent } = require('../lib/envelope')
const { Peer, waitFor, ev, hex } = require('../test/helpers')

const PORT = 49600 + (Bare.pid % 100)
const RUNS = parseInt(Bare.argv.find(a => a.startsWith('--runs='))?.split('=')[1] || '3')
const N = parseInt(Bare.argv.find(a => a.startsWith('--n='))?.split('=')[1] || '10000')

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), 'spike-3-1-bench', name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function dirSize(dir) {
  let total = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const e of entries) {
      const p = path.join(dir, e)
      const st = fs.statSync(p)
      if (st.isDirectory()) total += dirSize(p)
      else total += st.size
    }
  } catch {}
  return total
}

function rss() {
  try { return Bare.pid ? process.memoryUsage().rss : 0 } catch { return 0 }
}

function median(arr) {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a,b) => a-b)
  const m = Math.floor(s.length/2)
  if (s.length % 2) return s[m]
  return (s[m-1]+s[m])/2
}
function spread(arr) {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a,b) => a-b)
  return s[s.length-1] - s[0]
}

async function runOnce(i) {
  const boot = DHT.bootstrapper(PORT + i, '127.0.0.1')
  await boot.ready()
  const bootstrap = [{ host: '127.0.0.1', port: PORT + i }]
  const t0 = Date.now()
  const A = await new Peer('A'+i, { bootstrap }).ready()
  await A.base.append(ev(A.base, 'space.created'))
  await A.base.update()
  const B = await new Peer('B'+i, { bootstrap, bootstrapKey: A.base.key }).ready()
  await A.join()
  await B.join()
  await waitFor('conn', () => A.conns.size > 0 && B.conns.size > 0, 10000)
  await A.base.append(ev(A.base, 'member.added', { writerKey: hex(B.base.local.key) }))
  await waitFor('Bw', async () => { await B.base.update(); return B.base.writable }, 10000)
  const startupMs = Date.now() - t0
  const rssIdle = rss()
  
  // append N events from A
  const t1 = Date.now()
  const batch = []
  for (let j = 0; j < N; j++) {
    batch.push(ev(A.base, 'pledge.made', { orderId: 'o1', amount: j }))
    if (batch.length === 100) { for (const e of batch) await A.base.append(e); batch.length = 0 }
  }
  for (const e of batch) await A.base.append(e)
  await A.base.update()
  const appendMs = Date.now() - t1
  await A.base.ack()
  await waitFor('rep', async () => { await B.base.update(); return B.base.length >= A.base.length }, 60000)
  const rssAfter = rss()
  const diskA = dirSize(A.dir)
  const diskB = dirSize(B.dir)
  const bytesReplicated = B.base.signedLength * 1000 // rough estimate
  await A.close(); await B.close(); await boot.destroy()
  return { startupMs, rssIdle, rssAfter, appendMs, diskA, diskB, bytesReplicated }
}

async function main() {
  console.log(JSON.stringify({ runtime: 'Bare ' + Bare.version, runs: RUNS, n: N }))
  const results = []
  for (let i = 0; i < RUNS; i++) {
    try {
      const r = await runOnce(i)
      results.push(r)
      console.log(JSON.stringify({ run: i, ...r }))
    } catch (e) {
      console.log(JSON.stringify({ run: i, error: e.message }))
    }
  }
  const keys = ['startupMs', 'rssIdle', 'rssAfter', 'appendMs', 'diskA', 'diskB']
  const summary = {}
  for (const k of keys) {
    const arr = results.map(r => r[k]).filter(x => typeof x === 'number')
    summary[k] = { median: median(arr), spread: spread(arr), values: arr }
  }
  console.log(JSON.stringify({ summary }, null, 2))
}

main().then(() => Bare.exit(0), (e) => { console.error(e.stack); Bare.exit(2) })
