// AD-18 under Bare: a Corestore primaryKey derived from a seed (unsafe: true) reproduces the SAME
// writer core keys after a fresh restore on an EMPTY storage directory, and the restored device
// is still an admitted writer. Also probes the caveats.
const Corestore = require('corestore')
const fs = require('bare-fs')
const b4a = require('b4a')
const { Peer, tmpDir, waitFor, check, done, ev, hex, pipe, countPledges } = require('./helpers')
const { corestorePrimaryKey, identitySeed, rootSeedFromPhrase } = require('../lib/keys')

async function main() {
  console.log('runtime: Bare', Bare.version)
  const t0 = Date.now()
  const rootSeed = rootSeedFromPhrase('abandon ability able about above absent absorb abstract absurd abuse access accident', b4a.alloc(16, 'ocn-recovery-v1'))
  const argonMs = Date.now() - t0
  const primaryKey = corestorePrimaryKey(rootSeed)
  check('Argon2id(MODERATE) phrase -> root seed', rootSeed.byteLength === 32, argonMs + ' ms on this desktop (measure on device)')
  check('identity seed and primaryKey are distinct (domain separation)', !b4a.equals(identitySeed(rootSeed), primaryKey))

  // unsafe: true is required for a root store
  let threw = null
  try {
    new Corestore(tmpDir('nounsafe'), { primaryKey })
  } catch (err) {
    threw = err.message
  }
  check('primaryKey without unsafe: true throws', !!threw, JSON.stringify(threw))

  // the community: A is creator/indexer; M is the member whose phone will be lost
  const A = await new Peer('A').ready()
  await A.base.append(ev(A.base, 'space.created'))
  const dirM = tmpDir('M-phone1')
  const M = await new Peer('M', { dir: dirM, bootstrapKey: A.base.key, storeOpts: { primaryKey, unsafe: true } }).ready()
  const namedCore = M.store.get({ name: 'drafts' })
  await namedCore.ready()
  const before = { writer: hex(M.base.local.key), named: hex(namedCore.key) }
  await namedCore.close()

  let unpipe = pipe(A, M)
  await A.base.append(ev(A.base, 'member.added', { writerKey: before.writer }))
  await waitFor('M writable', async () => {
    await M.base.update()
    return M.base.writable
  })
  for (let i = 0; i < 3; i++) await M.base.append(ev(M.base, 'pledge.made', { orderId: 'o1', amount: 100 + i }))
  await waitFor('A sees M pledges', async () => {
    await A.base.update()
    return (await countPledges(A.base)) === 3
  })
  unpipe()
  const mLenBefore = M.base.local.length

  // the persisted seed lives in the store (at rest in the app sandbox)
  const persisted = await M.store.storage.getSeed()
  check('Corestore persists primaryKey inside its own storage (plaintext at rest)', b4a.equals(persisted, primaryKey))

  // copy of the storage directory (like an OS backup restore) before losing the phone
  await M.close()
  const dirCopy = tmpDir('M-backup-copy')
  fs.rmSync(dirCopy, { recursive: true, force: true })
  copyDir(dirM, dirCopy)

  // opening an existing store with a DIFFERENT primaryKey refuses
  let wrong = null
  try {
    const s = new Corestore(dirM, { primaryKey: b4a.alloc(32, 7), unsafe: true })
    await s.ready()
    await s.close()
  } catch (err) {
    wrong = err.message
  }
  check('existing storage + different primaryKey is refused', !!wrong, JSON.stringify(wrong))

  // phone lost: wipe it. Restore from the seed onto EMPTY directories.
  fs.rmSync(dirM, { recursive: true, force: true })
  const pk = () => corestorePrimaryKey(rootSeed)

  // (a) NAIVE restore: open the Autobase straight away on the empty store
  const skipNaive = Bare.argv.includes('--skip-naive')
  if (!skipNaive) {
  const dirN = tmpDir('M-phone2-naive')
  const tR = Date.now()
  const N = await new Peer('N', { dir: dirN, bootstrapKey: A.base.key, storeOpts: { primaryKey: pk(), unsafe: true } }).ready()
  const named2 = N.store.get({ name: 'drafts' })
  await named2.ready()
  check('restored writer core key is identical', hex(N.base.local.key) === before.writer, before.writer.slice(0, 16))
  check('restored named core key is identical', hex(named2.key) === before.named)
  await named2.close()
  check('before sync the restored local writer core is EMPTY', N.base.local.length === 0, 'local length 0 vs ' + mLenBefore + ' on the lost phone')
  unpipe = pipe(A, N)
  await waitFor('N writable + own core re-downloaded', async () => {
    await N.base.update()
    return N.base.writable && N.base.local.length === mLenBefore
  })
  check('restored device is a writer WITHOUT re-admission', N.base.writable, Date.now() - tR + ' ms')
  let naiveOk = false
  try {
    await waitFor('N linearises its own history', async () => {
      await N.base.update()
      return (await countPledges(N.base)) === 3
    }, 5000)
    naiveOk = true
  } catch {}
  console.log((naiveOk ? 'INFO ' : 'FINDING ') + 'naive restore (Autobase opened on an empty store) applies its own earlier writes: ' + naiveOk + ' (view pledges ' + (await countPledges(N.base)) + '/3, also after reopen in earlier runs)')
  unpipe()
  await N.close()
  }

  // (b) PRE-SYNC restore: download our own writer core from a peer BEFORE opening the Autobase
  const dirP = tmpDir('M-phone2-presync')
  const tP = Date.now()
  await presyncWriterCore(dirP, pk(), A, b4a.from(before.writer, 'hex'))
  const P = await new Peer('P', { dir: dirP, bootstrapKey: A.base.key, storeOpts: { primaryKey: pk(), unsafe: true } }).ready()
  unpipe = pipe(A, P)
  await waitFor('P has history', async () => {
    await P.base.update()
    if (Bare.argv.includes('--debug')) console.log('dbg P', P.base.writable, await countPledges(P.base), P.base.length, A.base.length, P.base.local.length)
    return P.base.writable && (await countPledges(P.base)) === 3
  })
  check('pre-synced restore: same writer, full history, no re-admission', hex(P.base.local.key) === before.writer, Date.now() - tP + ' ms')
  await P.base.append(ev(P.base, 'pledge.made', { orderId: 'o1', amount: 999 }))
  await waitFor('A sees restored write', async () => {
    await A.base.update()
    return (await countPledges(A.base)) === 4
  })
  check('a write from the restored device is accepted by A', true)
  unpipe()
  await P.close()

  // (c) CAVEAT probe: restore and APPEND before syncing with anyone (same key, divergent block 0..)
  const dirE = tmpDir('M-phone3-early')
  const E = await new Peer('E', { dir: dirE, bootstrapKey: A.base.key, storeOpts: { primaryKey: pk(), unsafe: true } }).ready()
  let early = 'appended'
  try {
    await E.base.append(ev(E.base, 'pledge.made', { orderId: 'o1', amount: -1 }))
  } catch (err) {
    early = 'threw: ' + err.message
  }
  console.log('INFO restored device appending before any sync: ' + early + ' (writable=' + E.base.writable + ', local length=' + E.base.local.length + ')')
  let aErr = null
  A.base.once('error', (e) => (aErr = e))
  unpipe = pipe(A, E)
  await new Promise((r) => setTimeout(r, 3000))
  await A.base.update().catch((e) => (aErr = aErr || e))
  console.log('INFO after the early-append device syncs: A pledges ' + (await countPledges(A.base)) + ', A error ' + (aErr ? aErr.message : 'none') + ', E pledges ' + (await countPledges(E.base)) + ', E local length ' + E.base.local.length)
  unpipe()
  await E.close().catch(() => {})

  // CAVEAT probe: opening a byte-for-byte copy of the old storage at a new path (OS backup restore)
  let copyOutcome = 'opened'
  try {
    const c = new Corestore(dirCopy, { primaryKey, unsafe: true })
    await c.ready()
    await c.close()
  } catch (err) {
    copyOutcome = 'refused: ' + err.message
  }
  console.log('INFO opening a copied storage directory at a new path: ' + copyOutcome)

  await A.close()
  return done()
}

// Download our own writer core from a peer into a fresh store before Autobase ever opens it.
async function presyncWriterCore(dir, primaryKey, peer, writerKey) {
  const store = new Corestore(dir, { primaryKey, unsafe: true })
  const local = store.namespace('space').get({ name: 'local' })
  await local.ready()
  if (!b4a.equals(local.key, writerKey)) throw new Error('derived writer key mismatch')
  const s1 = store.replicate(true)
  const s2 = peer.store.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  await local.update({ wait: true })
  await local.download({ start: 0, end: local.length }).done()
  s1.destroy()
  s2.destroy()
  await local.close()
  await store.close()
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = src + '/' + name
    const d = dst + '/' + name
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.writeFileSync(d, fs.readFileSync(s))
  }
}

main().then(
  (f) => Bare.exit(f ? 1 : 0),
  (err) => {
    console.error(err)
    Bare.exit(2)
  }
)
