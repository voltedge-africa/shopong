// Spike 3.1, under real Bare: two peers, Corestore + Autobase (custom apply, Hyperbee view) + Hyperswarm
// on a local HyperDHT bootstrapper. Proves writer admission, offline divergence and convergence,
// base.replicate(conn), signedLength with an indexer, and replay determinism across arrival orders.
const DHT = require('hyperdht')
const { Peer, waitFor, check, done, ev, hex, pipe, countPledges } = require('./helpers')

const PORT = 49800 + (Bare.pid % 100)

async function main() {
  console.log('runtime: Bare', Bare.version, Bare.platform, Bare.arch)
  const boot = DHT.bootstrapper(PORT, '127.0.0.1')
  await boot.ready()
  const bootstrap = [{ host: '127.0.0.1', port: PORT }]
  console.log('local HyperDHT bootstrapper on 127.0.0.1:' + PORT)

  // 1. creator A (writer + indexer)
  const A = await new Peer('A', { bootstrap }).ready()
  await A.base.append(ev(A.base, 'space.created'))
  await A.base.update()
  check('A is writer and indexer of a new space', A.base.writable && A.base.isIndexer)

  // 2. B opens the same space by key: not yet a writer
  const B = await new Peer('B', { bootstrap, bootstrapKey: A.base.key }).ready()
  check('B starts read-only', !B.base.writable)

  // 3. connect over Hyperswarm, replicate with base.replicate(conn)
  await A.join()
  await B.join()
  const tConn = await waitFor('swarm connection', () => A.conns.size > 0 && B.conns.size > 0)
  check('A and B connected over Hyperswarm via the local bootstrapper', true, tConn + ' ms')

  // 4. writer admission through apply -> host.addWriter
  await A.base.append(ev(A.base, 'member.added', { writerKey: hex(B.base.local.key), indexer: false }))
  const tWritable = await waitFor('B writable', async () => {
    await B.base.update()
    return B.base.writable
  })
  check('B became writable via host.addWriter in apply', B.base.writable, tWritable + ' ms after member.added')
  check('B is not an indexer', !B.base.isIndexer)

  // 5. a non-member's event is refused deterministically (the stand-in capability check)
  // simulate by appending from B an admin-only event
  await B.base.append(ev(B.base, 'member.added', { writerKey: 'aa'.repeat(32), indexer: true }))
  await B.base.append(ev(B.base, 'pledge.made', { orderId: 'o1', amount: 100 }))
  await waitFor('A sees B pledge', async () => {
    await A.base.update()
    return (await countPledges(A.base)) === 1
  })
  let refused = 0
  for await (const _ of A.base.view.createReadStream({ gte: 'refused/', lt: 'refused0' })) refused++
  check('non-admin member.added from B refused in apply', refused === 1)

  // 6. signedLength with a single indexer (A)
  await A.base.ack()
  await waitFor('B sees signedLength', async () => {
    await B.base.update()
    return B.base.signedLength === A.base.signedLength && A.base.signedLength > 0
  })
  check(
    'signedLength advances with the single indexer A and replicates to B',
    A.base.signedLength > 0,
    `A.signedLength=${A.base.signedLength} A.length=${A.base.length} B.signedLength=${B.base.signedLength}`
  )

  const before = await A.digest()
  check('A and B converge while online', before.sha512 === (await B.digest()).sha512)

  // 7. go offline and diverge
  await A.leave()
  await B.leave()
  for (let i = 0; i < 5; i++) {
    await A.base.append(ev(A.base, 'pledge.made', { orderId: 'o2', amount: 10 + i }))
    await B.base.append(ev(B.base, 'pledge.made', { orderId: 'o2', amount: 20 + i }))
  }
  await A.base.update()
  await B.base.update()
  const dA = await A.digest()
  const dB = await B.digest()
  check('offline views have diverged', dA.sha512 !== dB.sha512, `A=${dA.sha512.slice(0, 12)} B=${dB.sha512.slice(0, 12)}`)
  const signedOffline = A.base.signedLength

  // 8. fresh readers receive the divergent writes in OPPOSITE arrival orders (direct streams).
  // R1: A then B (default options). R2: B then A (default options, fastForward on).
  // R3: B then A with fastForward: false. (Finding: R2 can stall, see below.)
  const R1 = await new Peer('R1', { bootstrapKey: A.base.key }).ready()
  const R2 = await new Peer('R2', { bootstrapKey: A.base.key }).ready()
  const R3 = await new Peer('R3', { bootstrapKey: A.base.key, baseOpts: { fastForward: false } }).ready()

  async function feed(reader, first, second, ms = 20000) {
    let unpipe = pipe(reader, first)
    await waitFor(reader.name + ' first', async () => {
      await reader.base.update()
      return (await countPledges(reader.base)) >= 6
    })
    unpipe()
    unpipe = pipe(reader, second)
    try {
      await waitFor(reader.name + ' second', async () => {
        await reader.base.update()
        return (await countPledges(reader.base)) === 11
      }, ms)
      return true
    } catch {
      return false
    } finally {
      unpipe()
    }
  }

  check('R1 (A then B) linearised all 11 pledges', await feed(R1, A, B))
  const r3ok = await feed(R3, B, A)
  check('R3 (B then A, fastForward:false) linearised all 11 pledges', r3ok)
  const r2ok = await feed(R2, B, A, 5000)
  console.log((r2ok ? 'INFO ' : 'FINDING ') + 'R2 (B then A, fastForward default) ' + (r2ok ? 'linearised all 11 pledges' : 'STALLED at ' + (await countPledges(R2.base)) + '/11 pledges after fast-forwarding to the indexer A signed state, although it holds every block'))

  // 9. reconnect A and B over Hyperswarm
  const tRe0 = Date.now()
  await A.join()
  await B.join()
  await waitFor('A and B reconverge', async () => {
    await A.base.update()
    await B.base.update()
    return (await countPledges(A.base)) === 11 && (await countPledges(B.base)) === 11
  })
  const tReconverge = Date.now() - tRe0
  await A.base.ack()
  await waitFor('signedLength after reconnect', async () => {
    await B.base.update()
    return B.base.signedLength === A.base.signedLength
  })

  // R2 heals once it reconnects to a peer after the indexer has acked the merged state
  const tHeal0 = Date.now()
  const unpipe2 = pipe(R2, A)
  await waitFor('R2 heals', async () => {
    await R2.base.update()
    return (await countPledges(R2.base)) === 11
  })
  unpipe2()
  const unpipe3 = pipe(R3, A)
  await waitFor('R3 catches the final ack', async () => {
    await R3.base.update()
    return R3.base.length === A.base.length
  })
  unpipe3()
  const unpipe1 = pipe(R1, A)
  await waitFor('R1 catches the final ack', async () => {
    await R1.base.update()
    return R1.base.length === A.base.length
  })
  unpipe1()
  check('R2 recovered after reconnecting post-ack', true, Date.now() - tHeal0 + ' ms')

  const fA = await A.digest()
  const fB = await B.digest()
  const fR1 = await R1.digest()
  const fR2 = await R2.digest()
  const fR3 = await R3.digest()
  check('A and B converge after reconnect with no lost events', fA.sha512 === fB.sha512, `${tReconverge} ms, ${fA.entries} entries`)
  check('reader R1 (A then B) equals reader R2 (B then A): identical view bytes', fR1.sha512 === fR2.sha512, fR1.sha512.slice(0, 32))
  check('reader R3 (B then A, no fast-forward) identical view bytes', fR3.sha512 === fR1.sha512)
  check('readers equal writers', fR1.sha512 === fA.sha512)
  check('signedLength advanced after reconnect + ack', A.base.signedLength > signedOffline, `${signedOffline} -> ${A.base.signedLength}`)

  console.log(JSON.stringify({ result: 'converge', viewSha512: fA.sha512, entries: fA.entries, viewBytes: fA.bytes, reconvergeMs: tReconverge, connectMs: tConn, writableMs: tWritable, signedLength: A.base.signedLength, length: A.base.length, r2StalledBeforeAck: !r2ok }))

  for (const p of [R1, R2, R3, A, B]) await p.close()
  await boot.destroy()
  return done()
}

main().then(
  (f) => Bare.exit(f ? 1 : 0),
  (err) => {
    console.error(err)
    Bare.exit(2)
  }
)
