// F-12: which HyperDHT firewall return value blocks? Tested empirically under Bare
// against a local bootstrapper. Also: async firewall, throwing firewall, Hyperswarm firewall.
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')
const { check, done, sleep } = require('./helpers')

const PORT = 49700 + (Bare.pid % 100)
const bootstrap = [{ host: '127.0.0.1', port: PORT }]

async function attempt(label, firewall) {
  const serverNode = new DHT({ bootstrap, host: '127.0.0.1' })
  const clientNode = new DHT({ bootstrap, host: '127.0.0.1' })
  const calls = []
  const server = serverNode.createServer({
    firewall(remotePublicKey, payload, address) {
      calls.push({ remote: b4a.toString(remotePublicKey, 'hex').slice(0, 8), argc: arguments.length, address: address && address.host })
      return firewall(remotePublicKey, payload, address)
    }
  })
  server.on('connection', (s) => {
    s.on('error', () => {})
    s.end()
  })
  await server.listen()

  const socket = clientNode.connect(server.publicKey)
  const outcome = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 15000)
    socket.on('open', () => {
      clearTimeout(t)
      resolve('connected')
    })
    socket.on('error', (err) => {
      clearTimeout(t)
      resolve('blocked: ' + (err.code || err.message))
    })
  })
  socket.destroy()
  await server.close()
  await serverNode.destroy()
  await clientNode.destroy()
  console.log(`  ${label}: ${outcome}; firewall called ${calls.length}x with ${calls[0] ? calls[0].argc : 0} args`)
  return outcome
}

async function swarmAttempt(label, firewall, side = 'server') {
  // s1 only accepts (server), s2 only dials (client); the firewall sits on `side`
  const s1 = new Hyperswarm({ dht: new DHT({ bootstrap, host: '127.0.0.1' }), firewall: side === 'server' ? firewall : undefined })
  const s2 = new Hyperswarm({ dht: new DHT({ bootstrap, host: '127.0.0.1' }), firewall: side === 'client' ? firewall : undefined })
  let c1 = 0
  let c2 = 0
  s1.on('connection', (c) => {
    c1++
    c.on('error', () => {})
  })
  s2.on('connection', (c) => {
    c2++
    c.on('error', () => {})
  })
  const topic = b4a.alloc(32, label.length)
  await s1.join(topic, { server: true, client: false }).flushed()
  await s2.join(topic, { server: false, client: true }).flushed()
  await s2.flush()
  await sleep(1500)
  await s1.destroy()
  await s2.destroy()
  const outcome = c1 > 0 && c2 > 0 ? 'connected' : 'blocked'
  console.log(`  ${label}: ${outcome} (server conns ${c1}, client conns ${c2})`)
  return outcome
}

async function main() {
  console.log('runtime: Bare', Bare.version)
  const boot = DHT.bootstrapper(PORT, '127.0.0.1')
  await boot.ready()

  console.log('HyperDHT createServer({ firewall })')
  check('firewall returning false ALLOWS the connection', (await attempt('return false', () => false)) === 'connected')
  check('firewall returning true BLOCKS the connection', (await attempt('return true', () => true)).startsWith('blocked'))
  check('async firewall resolving true BLOCKS (HyperDHT awaits it)', (await attempt('async true', async () => { await sleep(50); return true })).startsWith('blocked'))
  check('async firewall resolving false ALLOWS', (await attempt('async false', async () => { await sleep(50); return false })) === 'connected')
  check('firewall that THROWS BLOCKS (fails closed)', (await attempt('throws', () => { throw new Error('x') })).startsWith('blocked'))
  check('firewall returning undefined ALLOWS (falsy)', (await attempt('return undefined', () => undefined)) === 'connected')

  console.log('Hyperswarm({ firewall })')
  check('swarm firewall returning true BLOCKS', (await swarmAttempt('swarm true', () => true)) === 'blocked')
  check('swarm firewall returning false ALLOWS', (await swarmAttempt('swarm false!', () => false)) === 'connected')
  check('swarm firewall on the dialling (client) side returning true BLOCKS', (await swarmAttempt('swarm client true', () => true, 'client')) === 'blocked')
  check('swarm SERVER side: async firewall resolving false ALLOWS (passed through to HyperDHT, awaited)', (await swarmAttempt('swarm server async(false)', async () => false, 'server')) === 'connected')
  check('swarm CLIENT side: firewall is SYNC only, a Promise is truthy and BLOCKS even if it resolves false', (await swarmAttempt('swarm client async(false)', async () => false, 'client')) === 'blocked')

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
