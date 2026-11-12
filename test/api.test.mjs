import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHandler } from '../lib/api.js'
import { createStore } from '../lib/store.js'
import { createPricing, BEIJING_OFFSET_MS } from '../lib/pricing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmpRoot = path.join(here, '.tmp-api')

function record(seq, t) {
  return {
    sid: 'session-1',
    seq,
    turn: 1,
    step: seq,
    t,
    pr: 'deepseek-account',
    m: 'deepseek-v4-pro',
    i: 1000,
    o: 100,
    cr: 9000,
    cw: 0,
    cost: 0.0123,
    pk: 1,
  }
}

async function harness({ account } = {}) {
  const dir = path.join(tmpRoot, `api-${process.pid}-${Math.random().toString(16).slice(2, 8)}`)
  await fs.mkdir(dir, { recursive: true })
  const store = createStore({ dir })
  await store.load()
  store.append([record(1, Date.UTC(2026, 10, 12, 2, 0) - BEIJING_OFFSET_MS + 8 * 3600e3)])
  store.updateSessionMeta('session-1', { label: 'default', origin: 'root', seq: 1 })
  await store.flush()

  const pricing = createPricing()
  const sync = { lastSyncAt: 1, lastAdded: 1, lastErrors: [], ensure: async () => ({ added: 0 }) }
  const ctx = { get: (name) => (name === 'deepseekAccount' ? account : undefined) }
  const handler = createHandler({ ctx, store, pricing, sync, config: {}, log: () => {} })

  function call(url, method = 'GET') {
    const req = { url, method }
    return new Promise((resolve) => {
      const res = {
        status: 0,
        headers: null,
        body: '',
        writeHead(status, headers) {
          this.status = status
          this.headers = headers
        },
        end(body) {
          this.body = body
          resolve(this)
        },
      }
      handler(req, res)
    })
  }
  return { call, dir, store }
}

test('GET /api/health 返回存储统计与最近请求', async () => {
  const { call } = await harness()
  await call('/usage-dashboard/api/summary?range=7d')
  const res = await call('/usage-dashboard/api/health')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.ok(payload.records >= 1)
  assert.ok(Array.isArray(payload.requests))
  assert.ok(payload.requests.some((entry) => entry.path === '/usage-dashboard/api/summary'))
})

test('GET /api/summary 按筛选返回聚合结果', async () => {
  const { call } = await harness()
  const res = await call('/usage-dashboard/api/summary?range=all&session=current&sid=session-1')
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.overview.steps, 1)
  assert.equal(payload.session, 'current')
  assert.ok(payload.groups.length >= 1)
  assert.ok(payload.period.kind === 'peak' || payload.period.kind === 'valley')
})

test('GET /api/live 返回会话与当前轮次', async () => {
  const { call } = await harness()
  const res = await call('/usage-dashboard/api/live?sid=session-1')
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.session.steps, 1)
  assert.equal(payload.turn.turn, 1)
  assert.equal(typeof payload.peak, 'boolean')
  assert.equal(payload.period.label, payload.peak ? '峰时' : '谷时')
})

test('GET /api/balance 账号未登录时静默降级', async () => {
  const { call } = await harness()
  const res = await call('/usage-dashboard/api/balance')
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.ok(payload.reason)
})

test('GET /api/balance 高精度余额字符串被格式化为最多 4 位小数', async () => {
  const account = {
    async getBalance() {
      return {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '84.0871764200000000' }],
        bonusWallets: [{ currency: 'CNY', balance: '1.5000000000000000' }],
      }
    },
  }
  const { call } = await harness({ account })
  const first = JSON.parse((await call('/usage-dashboard/api/balance')).body)
  assert.equal(first.ok, true)
  assert.equal(first.currency, 'CNY')
  assert.equal(first.total, '84.0872')
  assert.deepEqual(first.wallets, [{ currency: 'CNY', balance: '84.0872' }])
  assert.deepEqual(first.bonusWallets, [{ currency: 'CNY', balance: '1.5' }])
})

test('未知路由与非法路径返回 404 JSON', async () => {
  const { call } = await harness()
  const missing = await call('/usage-dashboard/api/nope')
  assert.equal(missing.status, 404)
  assert.equal(JSON.parse(missing.body).ok, false)
  const outside = await call('/other/api/health')
  assert.equal(outside.status, 404)
})

test.after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})
