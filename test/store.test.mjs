import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from '../lib/store.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmpRoot = path.join(here, '.tmp')

async function makeDir(name) {
  const dir = path.join(tmpRoot, `${name}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function sample(seq, sid = 's1', cost = 0.01) {
  return { sid, seq, turn: 1, step: seq, t: 1_800_000_000_000 + seq, pr: 'deepseek-account', m: 'deepseek-v4-pro', i: 10, o: 1, cr: 0, cw: 0, cost, pk: 1 }
}

test('store：追加、去重、落盘、重新载入', async () => {
  const dir = await makeDir('store')
  const store = createStore({ dir, cap: 100 })
  await store.load()
  assert.equal(store.append([sample(1), sample(2)]), 2)
  assert.equal(store.append([sample(2), sample(3)]), 1, '重复的 (sid,seq) 不再计入')
  await store.flush()
  assert.equal(store.records.length, 3)

  const raw = await fs.readFile(path.join(dir, 'usage-analytics.jsonl'), 'utf8')
  assert.equal(raw.trim().split('\n').length, 3)

  const reloaded = createStore({ dir, cap: 100 })
  await reloaded.load()
  assert.equal(reloaded.records.length, 3)
  assert.equal(reloaded.append([sample(1)]), 0, '重新载入后仍能识别重复')
  await reloaded.flush()
})

test('store：超过软上限时裁掉最旧记录并整体重写', async () => {
  const dir = await makeDir('store-cap')
  const store = createStore({ dir, cap: 2 })
  await store.load()
  store.append([sample(1), sample(2), sample(3)])
  await store.flush()
  assert.equal(store.records.length, 2)
  assert.deepEqual(store.records.map((record) => record.seq), [2, 3])
  const raw = await fs.readFile(path.join(dir, 'usage-analytics.jsonl'), 'utf8')
  assert.equal(raw.trim().split('\n').length, 2)
  const reloaded = createStore({ dir, cap: 2 })
  await reloaded.load()
  assert.deepEqual(reloaded.records.map((record) => record.seq), [2, 3])
})

test('store：会话元信息与水位持久化', async () => {
  const dir = await makeDir('store-meta')
  const store = createStore({ dir })
  await store.load()
  store.updateSessionMeta('s1', { label: 'default', seq: 42, lastAt: 123 })
  await store.flush()
  const reloaded = createStore({ dir })
  await reloaded.load()
  assert.equal(reloaded.sessionMeta('s1').label, 'default')
  assert.equal(reloaded.sessionMeta('s1').seq, 42)
})

test('store：损坏的 JSONL 行被跳过而不是让整个文件失败', async () => {
  const dir = await makeDir('store-broken')
  await fs.writeFile(path.join(dir, 'usage-analytics.jsonl'), `${JSON.stringify(sample(1))}\n{broken\n${JSON.stringify(sample(2))}\n`)
  const store = createStore({ dir })
  await store.load()
  assert.equal(store.records.length, 2)
  assert.ok(store.errors.length === 0 || store.errors.every((entry) => typeof entry === 'string'))
})

test('store：价格表版本变化时重算历史成本并写回文件', async () => {
  const dir = await makeDir('store-reprice')
  const stale = { ...sample(1), cost: 999, pv: 'old-version' }
  await fs.writeFile(path.join(dir, 'usage-analytics.jsonl'), `${JSON.stringify(stale)}\n`)
  const store = createStore({ dir })
  await store.load({
    reprice: (record) => (record.pv === 'v2' ? null : { cost: 0.5, pk: 0, pv: 'v2' }),
  })
  assert.equal(store.records[0].cost, 0.5)
  assert.equal(store.records[0].pv, 'v2')
  const raw = await fs.readFile(path.join(dir, 'usage-analytics.jsonl'), 'utf8')
  assert.match(raw, /"pv":"v2"/)
  assert.doesNotMatch(raw, /999/)

  const reloaded = createStore({ dir })
  await reloaded.load({ reprice: (record) => (record.pv === 'v2' ? null : { cost: 0, pk: 0, pv: 'v2' }) })
  assert.equal(reloaded.records[0].cost, 0.5, '已重算的记录不会再被改写')
})

test.after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})
