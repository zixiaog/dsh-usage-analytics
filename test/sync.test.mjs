import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from '../lib/store.js'
import { createSync } from '../lib/sync.js'
import { createPricing } from '../lib/pricing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmpRoot = path.join(here, '.tmp-sync')
const pricing = createPricing()

function assistantMessage(seq) {
  return {
    type: 'assistant/message',
    seq,
    time: Date.UTC(2026, 10, 12, 2, seq),
    data: {
      turn: 1,
      step: seq,
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-v4-pro' } },
    },
  }
}

function fakeContext(sessions) {
  return {
    sessionPersistence: {
      async list() {
        return sessions.map((session) => ({
          header: session.header,
          eventCount: session.events.length,
          revision: `rev-${session.events.length}`,
        }))
      },
      async open(id) {
        const session = sessions.find((entry) => entry.header.id === id)
        return {
          id,
          header: session.header,
          async read(offset = 0) {
            return { events: session.events.slice(offset) }
          },
          async close() {},
        }
      },
    },
  }
}

async function makeDir(name) {
  const dir = path.join(tmpRoot, `${name}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

test('sync：回填全部会话，第二次因水位与 revision 跳过', async () => {
  const dir = await makeDir('sync')
  const store = createStore({ dir })
  await store.load()
  const sessions = [
    { header: { id: 's1', cwd: 'F:\\work\\default', createdAt: 1, origin: undefined }, events: [assistantMessage(0), assistantMessage(1)] },
    { header: { id: 's2', cwd: 'F:\\work\\other', createdAt: 2, origin: 'subagent' }, events: [assistantMessage(0)] },
  ]
  const ctx = fakeContext(sessions)
  const sync = createSync({ ctx, store, pricing, log: () => {} })

  const first = await sync.ensure({ maxMs: 5000 })
  assert.equal(first.added, 3)
  assert.equal(first.scanned, 2)
  await store.flush()
  assert.equal(store.records.length, 3)
  assert.equal(store.sessionMeta('s1').label, 'default')
  assert.equal(store.sessionMeta('s1').seq, 1)
  assert.equal(store.sessionMeta('s2').origin, 'subagent')

  const second = await sync.ensure({ maxMs: 5000, force: true })
  assert.equal(second.added, 0)
  assert.equal(second.skipped, 2)
})

test('sync：新追加的事件只回填增量部分', async () => {
  const dir = await makeDir('sync-tail')
  const store = createStore({ dir })
  await store.load()
  const sessions = [{ header: { id: 's1', cwd: 'F:\\work\\default' }, events: [assistantMessage(0)] }]
  const ctx = fakeContext(sessions)
  const sync = createSync({ ctx, store, pricing, log: () => {} })
  await sync.ensure({ maxMs: 5000 })
  await store.flush()
  assert.equal(store.records.length, 1)

  sessions[0].events.push(assistantMessage(1), assistantMessage(2))
  const result = await sync.ensure({ maxMs: 5000, force: true })
  assert.equal(result.added, 2)
  await store.flush()
  assert.equal(store.records.length, 3)
})

test('sync：某个会话打开失败不影响其它会话', async () => {
  const dir = await makeDir('sync-error')
  const store = createStore({ dir })
  await store.load()
  const ctx = {
    sessionPersistence: {
      async list() {
        return [
          { header: { id: 'bad', cwd: 'x' }, eventCount: 1, revision: 'r1' },
          { header: { id: 'good', cwd: 'y' }, eventCount: 1, revision: 'r2' },
        ]
      },
      async open(id) {
        if (id === 'bad') throw new Error('boom')
        return {
          async read() {
            return { events: [assistantMessage(0)] }
          },
          async close() {},
        }
      },
    },
  }
  const sync = createSync({ ctx, store, pricing, log: () => {} })
  const result = await sync.ensure({ maxMs: 5000 })
  assert.equal(result.added, 1)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0].error, /boom/)
})

test.after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})
