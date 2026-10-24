// Probe: does pre-syncing the restored writer core BEFORE Autobase ever opens avoid the stall?
const Corestore = require('corestore')
const b4a = require('b4a')
const { Peer, tmpDir, waitFor, ev, hex, pipe, countPledges } = require('./helpers')
const { corestorePrimaryKey } = require('../lib/keys')

async function main() {
  const primaryKey = corestorePrimaryKey(b4a.alloc(32, 9))
  const A = await new Peer('A').ready()
  await A.base.append(ev(A.base, 'space.created'))
  const M = await new Peer('M', { bootstrapKey: A.base.key, storeOpts: { primaryKey, unsafe: true } }).ready()
  let un = pipe(A, M)
  await A.base.append(ev(A.base, 'member.added', { writerKey: hex(M.base.local.key) }))
  await waitFor('M writable', async () => (await M.base.update(), M.base.writable))
  for (let i = 0; i < 3; i++) await M.base.append(ev(M.base, 'pledge.made', { orderId: 'o', amount: i }))
  await waitFor('A has 3', async () => (await A.base.update(), (await countPledges(A.base)) === 3))
  un()
  const writerKey = M.base.local.key
  await M.close()

  // fresh device: plain Corestore first
  const dir = tmpDir('presync')
  const store = new Corestore(dir, { primaryKey, unsafe: true })
  const local = store.namespace('space').get({ name: 'local' })
  await local.ready()
  console.log('derived local key matches:', b4a.equals(local.key, writerKey))
  const s1 = store.replicate(true)
  const s2 = A.store.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  const remote = A.store.get({ key: writerKey })
  await remote.ready()
  await local.update({ wait: true })
  await local.download({ start: 0, end: remote.length }).done()
  console.log('pre-synced local length', local.length, 'of', remote.length)
  await remote.close()
  s1.destroy()
  s2.destroy()
  await local.close()
  await store.close()

  const M3 = await new Peer('M3', { dir, bootstrapKey: A.base.key, storeOpts: { primaryKey, unsafe: true } }).ready()
  un = pipe(A, M3)
  let ok = false
  try {
    await waitFor('M3 history', async () => (await M3.base.update(), (await countPledges(M3.base)) === 3), 8000)
    ok = true
  } catch {}
  console.log('RESULT pre-sync before opening Autobase -> history linearised:', ok, 'writable', M3.base.writable, 'pledges', await countPledges(M3.base))
  un()
  await M3.close()
  await A.close()
}
main().then(() => Bare.exit(0), (e) => { console.error(e); Bare.exit(2) })
