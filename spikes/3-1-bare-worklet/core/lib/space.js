// One community space = one Autobase with our own deterministic apply and a Hyperbee view (AD-2).
// apply reads ONLY its arguments: no Date.now, no Math.random, no network, no env.
const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const b4a = require('b4a')
const { eventId, canonical, sha512Hex } = require('./envelope')

const APPLY_VERSION = 1

function open(store) {
  return new Hyperbee(store.get('view'), {
    keyEncoding: 'utf-8',
    valueEncoding: 'json',
    extension: false
  })
}

async function apply(nodes, view, host) {
  for (const node of nodes) {
    const ev = node.value
    if (ev === null) continue // ack nodes
    const id = eventId(ev)
    const from = b4a.toString(node.from.key, 'hex')

    // log time: highest claimedAt accepted so far (AD-6), read from the view, never the clock
    const lt = await view.get('meta/logTime')
    const logTime = lt ? lt.value : 0
    if (ev.claimedAt > logTime) await view.put('meta/logTime', ev.claimedAt)

    if (ev.type === 'space.created') {
      const existing = await view.get('meta/space')
      if (existing) {
        await view.put('refused/' + id, { reason: 'already created', from })
        continue
      }
      await view.put('meta/space', { applyVersion: APPLY_VERSION, root: from })
      await view.put('members/' + from, { role: 'admin', indexer: true })
      continue
    }

    // every other event must come from a known member (stand-in for the UCAN check in story 3.3)
    const member = await view.get('members/' + from)
    if (!member) {
      await view.put('refused/' + id, { reason: 'not a member', from })
      continue
    }

    if (ev.type === 'member.added') {
      if (member.value.role !== 'admin') {
        await view.put('refused/' + id, { reason: 'not admin', from })
        continue
      }
      const key = b4a.from(ev.payload.writerKey, 'hex')
      await host.addWriter(key, { indexer: !!ev.payload.indexer })
      await view.put('members/' + ev.payload.writerKey, {
        role: ev.payload.role || 'member',
        indexer: !!ev.payload.indexer
      })
      continue
    }

    if (ev.type === 'pledge.made') {
      await view.put('pledges/' + ev.payload.orderId + '/' + from + '/' + id, {
        amount: ev.payload.amount,
        claimedAt: ev.claimedAt
      })
      continue
    }

    await view.put('refused/' + id, { reason: 'unknown type ' + ev.type, from })
  }
}

function createSpace(store, bootstrap = null, opts = {}) {
  return new Autobase(store, bootstrap, {
    open,
    apply,
    valueEncoding: 'json',
    ackInterval: opts.ackInterval || 0,
    ...opts
  })
}

// Canonical bytes of the whole view (every key/value in key order) and their SHA-512.
async function viewDigest(base) {
  await base.view.ready()
  const entries = []
  for await (const { key, value } of base.view.createReadStream()) entries.push([key, value])
  const bytes = b4a.from(canonical(entries))
  return { entries: entries.length, bytes: bytes.byteLength, sha512: sha512Hex(bytes) }
}

module.exports = { createSpace, viewDigest, apply, open, APPLY_VERSION }
