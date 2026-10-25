const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const DHT = require('hyperdht')
const fs = require('bare-fs')
const path = require('bare-path')
const os = require('bare-os')
const b4a = require('b4a')
const { createSpace, viewDigest } = require('../lib/space')
const { makeEvent } = require('../lib/envelope')

const hex = (b) => b4a.toString(b, 'hex')

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), 'spike-3-1', name + '-' + os.pid())
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(label, fn, ms = 20000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn()) return Date.now() - start
    await sleep(25)
  }
  throw new Error('timeout waiting for ' + label)
}

let failures = 0
function check(label, ok, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!ok) failures++
}
function done() {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
  return failures
}

// writer-side clock and nonce: allowed here, never inside apply
let clock = 1_700_000_000_000
function ev(base, type, payload = {}) {
  clock += 1000
  return makeEvent({
    type,
    space: base.key ? hex(base.key) : null,
    actor: hex(base.local.key),
    payload,
    claimedAt: clock,
    nonce: hex(require('hypercore-crypto').randomBytes(16))
  })
}

class Peer {
  constructor(name, { bootstrapKey = null, bootstrap, dir, storeOpts = {}, baseOpts = {}, firewall } = {}) {
    this.name = name
    this.dir = dir || tmpDir(name)
    this.store = new Corestore(this.dir, storeOpts)
    this.base = createSpace(this.store.namespace('space'), bootstrapKey, baseOpts)
    this.bootstrap = bootstrap
    this.firewall = firewall
    this.swarm = null
    this.conns = new Set()
  }

  async ready() {
    await this.base.ready()
    return this
  }

  async join() {
    this.swarm = new Hyperswarm({
      dht: new DHT({ bootstrap: this.bootstrap, host: '127.0.0.1' }),
      firewall: this.firewall
    })
    this.swarm.on('connection', (conn) => {
      this.conns.add(conn)
      conn.on('close', () => this.conns.delete(conn))
      conn.on('error', () => {})
      this.base.replicate(conn) // base.replicate, not store.replicate: carries the wakeup protocol
    })
    const d = this.swarm.join(this.base.discoveryKey, { server: true, client: true })
    await d.flushed()
  }

  async leave() {
    if (!this.swarm) return
    const s = this.swarm
    this.swarm = null
    await s.destroy()
    this.conns.clear()
  }

  digest() {
    return viewDigest(this.base)
  }

  async close() {
    await this.leave()
    await this.base.close()
    await this.store.close()
  }
}

function pipe(a, b) {
  const s1 = a.base.replicate(true)
  const s2 = b.base.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  return () => {
    s1.destroy()
    s2.destroy()
  }
}

async function countPledges(base) {
  let n = 0
  for await (const _ of base.view.createReadStream({ gte: 'pledges/', lt: 'pledges0' })) n++
  return n
}

module.exports = { Peer, tmpDir, waitFor, sleep, check, done, ev, hex, pipe, countPledges }
