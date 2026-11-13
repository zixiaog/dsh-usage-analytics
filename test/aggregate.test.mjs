import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregate,
  beijingDateKey,
  beijingDayStart,
  beijingHour,
  liveSummary,
  parseDayKey,
} from '../lib/aggregate.js'
import { createPricing, BEIJING_OFFSET_MS } from '../lib/pricing.js'

const pricing = createPricing()

function at(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute) - BEIJING_OFFSET_MS
}

function record(partial) {
  const t = partial.t ?? at(2026, 11, 12, 10, 0)
  const usage = {
    inputTokens: partial.i ?? 1000,
    outputTokens: partial.o ?? 100,
    cacheReadTokens: partial.cr ?? 0,
    cacheWriteTokens: partial.cw ?? 0,
  }
  return {
    sid: partial.sid ?? 's1',
    seq: partial.seq ?? 1,
    turn: partial.turn ?? 1,
    step: partial.step ?? 1,
    t,
    pr: partial.pr ?? 'deepseek-account',
    m: partial.m ?? 'deepseek-v4-pro',
    i: usage.inputTokens,
    o: usage.outputTokens,
    cr: usage.cacheReadTokens,
    cw: usage.cacheWriteTokens,
    cost: partial.cost ?? pricing.costOf(usage, partial.m ?? 'deepseek-v4-pro', t),
    pk: pricing.isPeak(t) ? 1 : 0,
  }
}

const meta = {
  s1: { label: 'default', origin: 'root', createdAt: 0 },
  s2: { label: 'FeedingRecords', origin: 'subagent', createdAt: 0 },
}

test('beijingDayStart / beijingDateKey 以北京时间切日', () => {
  const t = at(2026, 11, 12, 0, 30)
  assert.equal(beijingDateKey(t), '2026-11-12')
  assert.equal(beijingDateKey(beijingDayStart(t)), '2026-11-12')
  assert.equal(beijingHour(at(2026, 11, 12, 23, 59)), 23)
  assert.equal(beijingDateKey(at(2026, 11, 12, 0, 0) - 1), '2026-11-11')
})

test('parseDayKey：合法日期解析、非法拒绝', () => {
  assert.ok(parseDayKey('2026-11-12') !== null)
  assert.equal(parseDayKey('2026-13-01'), null)
  assert.equal(parseDayKey('2026-02-30'), null)
  assert.equal(parseDayKey('bad'), null)
})

test('aggregate：时间范围、峰谷拆分、缓存命中率', () => {
  const now = at(2026, 11, 12, 20, 0)
  const records = [
    record({ t: at(2026, 11, 12, 10, 0), seq: 1, cr: 9000, i: 1000, cost: 1 }),
    record({ t: at(2026, 11, 12, 15, 0), seq: 2, cr: 0, i: 2000, cost: 2 }),
    record({ t: at(2026, 11, 11, 3, 0), seq: 3, sid: 's2', cost: 3 }),
    record({ t: at(2026, 10, 1, 3, 0), seq: 4, sid: 's2', cost: 4 }),
  ]
  const today = aggregate({ records, sessionMeta: meta, pricing, filters: { range: 'today' }, now })
  assert.equal(today.overview.cost, 3)
  assert.equal(today.overview.steps, 2)
  assert.equal(today.overview.peakSteps, 2)
  assert.equal(today.overview.valleySteps, 0)
  assert.equal(today.overview.turns, 1, '同会话同轮次只算一轮')

  const week = aggregate({ records, sessionMeta: meta, pricing, filters: { range: '7d' }, now })
  assert.equal(week.overview.cost, 6)
  assert.equal(week.overview.peakCost, 3)
  assert.equal(week.overview.valleyCost, 3)
  assert.equal(week.overview.sessions, 2)
  assert.equal(week.days.length, 2)

  const all = aggregate({ records, sessionMeta: meta, pricing, filters: { range: 'all' }, now })
  assert.equal(all.overview.cost, 10)
})

test('aggregate：会话/模型筛选与模型分布', () => {
  const now = at(2026, 11, 12, 20, 0)
  const records = [
    record({ sid: 's1', m: 'deepseek-v4-pro', cost: 2, t: at(2026, 11, 12, 10, 0), seq: 1 }),
    record({ sid: 's2', m: 'deepseek-v4-flash', cost: 1, t: at(2026, 11, 12, 10, 0), seq: 2 }),
  ]
  const filtered = aggregate({
    records,
    sessionMeta: meta,
    pricing,
    filters: { range: 'today', session: 'current', sid: 's1' },
    now,
  })
  assert.equal(filtered.overview.cost, 2)
  assert.equal(filtered.sessions.length, 1)

  const byModel = aggregate({ records, sessionMeta: meta, pricing, filters: { range: 'today', model: 'deepseek-v4-flash' }, now })
  assert.equal(byModel.overview.cost, 1)

  const models = aggregate({ records, sessionMeta: meta, pricing, filters: { range: 'today' }, now }).models
  assert.equal(models.length, 2)
  assert.equal(models[0].model, 'deepseek-v4-pro')
  assert.ok(Math.abs(models[0].share - 2 / 3) < 1e-6)
})

test('aggregate：按日期下钻输出 24 小时分布与当日会话', () => {
  const now = at(2026, 11, 12, 23, 0)
  const records = [
    record({ t: at(2026, 11, 12, 10, 0), seq: 1, cost: 1 }),
    record({ t: at(2026, 11, 12, 15, 0), seq: 2, cost: 2 }),
    record({ t: at(2026, 11, 12, 15, 30), seq: 3, sid: 's2', cost: 4 }),
    record({ t: at(2026, 11, 11, 10, 0), seq: 4, cost: 8 }),
  ]
  const day = aggregate({ records, sessionMeta: meta, pricing, filters: { day: '2026-11-12' }, now })
  assert.equal(day.overview.cost, 7)
  assert.equal(day.range, 'day')
  assert.equal(day.hourly.length, 24)
  assert.equal(day.hourly[10].cost, 1)
  assert.equal(day.hourly[15].cost, 6)
  assert.equal(day.days.length, 1)
  assert.equal(day.sessions.length, 2)
})

test('aggregate：最近记录按 (会话,轮次) 分组并保留步骤', () => {
  const now = at(2026, 11, 12, 23, 0)
  const records = [
    record({ turn: 1, step: 1, seq: 1, t: at(2026, 11, 12, 10, 0) }),
    record({ turn: 1, step: 2, seq: 2, t: at(2026, 11, 12, 10, 1) }),
    record({ turn: 2, step: 1, seq: 3, t: at(2026, 11, 12, 11, 0) }),
  ]
  const result = aggregate({ records, sessionMeta: meta, pricing, filters: { range: 'today' }, now })
  assert.equal(result.groups.length, 2)
  assert.equal(result.groups[0].turn, 2, '最近的轮次排在最前')
  assert.equal(result.groups[1].steps.length, 2)
  assert.deepEqual(result.groups[1].steps.map((step) => step.step), [1, 2])
  assert.equal(result.recent.length, 3)
})

test('aggregate：按次工具费计入成本，但不计入步数 / Token / 模型分布', () => {
  const now = at(2026, 11, 12, 20, 0)
  const records = [
    record({ t: at(2026, 11, 12, 10, 0), seq: 1, cost: 1, i: 1000, cr: 9000 }),
    { sid: 's1', seq: 2, t: at(2026, 11, 12, 10, 5), kind: 'fee', f: 'search', n: 3, cost: 0.015, pk: 0 },
    { sid: 's1', seq: 3, t: at(2026, 11, 12, 10, 6), kind: 'fee', f: 'fetch', n: 2, cost: 0.01, pk: 0 },
  ]
  const result = aggregate({ records, sessionMeta: meta, pricing, filters: { range: 'today' }, now })
  assert.ok(Math.abs(result.overview.cost - 1.025) < 1e-9, '总成本含工具费')
  assert.ok(Math.abs(result.overview.modelCost - 1) < 1e-9)
  assert.ok(Math.abs(result.overview.feeCost - 0.025) < 1e-9)
  assert.equal(result.overview.searchRequests, 3)
  assert.equal(result.overview.fetchRequests, 2)
  assert.equal(result.overview.steps, 1, '费用不计步数')
  assert.equal(result.overview.tokens, 10100, '费用不计 Token（1000 未命中 + 9000 命中 + 100 输出）')
  assert.equal(result.models.length, 1, '费用不进模型分布')
  assert.equal(result.days[0].feeCost > 0, true)
  assert.equal(result.groups[0].steps.length, 1, '最近记录不含费用')
})

test('liveSummary：会话累计与最新一轮', () => {
  const now = at(2026, 11, 12, 12, 0)
  const records = [
    record({ turn: 1, step: 1, seq: 1, cost: 1 }),
    record({ turn: 3, step: 1, seq: 2, cost: 2 }),
    record({ turn: 3, step: 2, seq: 3, cost: 4 }),
    record({ sid: 's2', turn: 9, step: 1, seq: 4, cost: 8 }),
  ]
  const live = liveSummary({ records, sid: 's1', now })
  assert.equal(live.session.cost, 7)
  assert.equal(live.session.turns, 2)
  assert.equal(live.turn.turn, 3)
  assert.equal(live.turn.cost, 6)
  assert.equal(live.turn.steps, 2)
  assert.equal(liveSummary({ records, sid: '', now }).session, null)
})
