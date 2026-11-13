import test from 'node:test'
import assert from 'node:assert/strict'
import { recordFromEvent, foldSessionEvents, recordKey, feeRecordFromEvent, recordsFromEvent } from '../lib/scan.js'
import { createPricing, BEIJING_OFFSET_MS } from '../lib/pricing.js'

const pricing = createPricing()

function assistantMessage({ seq = 1, time = Date.UTC(2026, 10, 12, 2, 0), usage, model = 'deepseek-v4-pro' }) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      usage,
      message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek-account', model } },
    },
  }
}

test('recordFromEvent：从 usage 与 message.source 生成记录', () => {
  const event = assistantMessage({
    usage: { inputTokens: 3093, outputTokens: 265, cacheReadTokens: 20608, cacheWriteTokens: 0 },
  })
  const record = recordFromEvent('session-abc', event, pricing)
  assert.equal(record.sid, 'session-abc')
  assert.equal(record.seq, 1)
  assert.equal(record.turn, 1)
  assert.equal(record.step, 1)
  assert.equal(record.m, 'deepseek-v4-pro')
  assert.equal(record.pr, 'deepseek-account')
  assert.equal(record.i, 3093)
  assert.equal(record.o, 265)
  assert.equal(record.cr, 20608)
  assert.equal(record.cw, 0)
  assert.ok(record.cost > 0)
  assert.equal(record.pk, 1, '北京时间 10:00 是峰时')
})

test('recordFromEvent：无 usage / 非 assistant/message 返回 null', () => {
  assert.equal(recordFromEvent('s', { type: 'assistant/message', seq: 1, data: {} }, pricing), null)
  assert.equal(recordFromEvent('s', { type: 'tool/call', seq: 1, data: {} }, pricing), null)
  assert.equal(recordFromEvent('s', null, pricing), null)
})

test('recordKey：会话 + seq 唯一', () => {
  assert.equal(recordKey({ sid: 's1', seq: 7 }), 's1#7')
})

test('foldSessionEvents：增量折叠只返回水位之后的事件', () => {
  const events = [1, 2, 3].map((seq) =>
    assistantMessage({
      seq,
      time: Date.UTC(2026, 10, 12, 2, seq),
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
  )
  const all = foldSessionEvents('s', events, pricing, -1)
  assert.equal(all.records.length, 3)
  assert.equal(all.lastSeq, 3)

  const tail = foldSessionEvents('s', events, pricing, 1)
  assert.deepEqual(tail.records.map((record) => record.seq), [2, 3])
  assert.equal(tail.lastSeq, 3)
})

test('feeRecordFromEvent：web_search 按 queries 条数、web_fetch 按 URL 条数计费', () => {
  const search = {
    type: 'tool/call',
    seq: 7,
    time: Date.UTC(2026, 10, 13, 2, 0),
    data: { name: 'web_search', arguments: JSON.stringify({ queries: ['a', 'b', 'c'] }) },
  }
  const fee = feeRecordFromEvent('s', search, pricing)
  assert.equal(fee.kind, 'fee')
  assert.equal(fee.f, 'search')
  assert.equal(fee.n, 3)
  assert.ok(Math.abs(fee.cost - 0.015) < 1e-9, '3 次搜索 × ¥0.005')

  const fetchCall = {
    type: 'tool/call',
    seq: 8,
    time: Date.UTC(2026, 10, 13, 2, 1),
    data: { name: 'web_fetch', arguments: JSON.stringify({ urls: ['https://a', 'https://b'] }) },
  }
  const fetchFee = feeRecordFromEvent('s', fetchCall, pricing)
  assert.equal(fetchFee.f, 'fetch')
  assert.equal(fetchFee.n, 2)
  assert.ok(Math.abs(fetchFee.cost - 0.01) < 1e-9)

  assert.equal(feeRecordFromEvent('s', { type: 'tool/call', seq: 9, data: { name: 'read', arguments: '{}' } }, pricing), null)
})

test('recordsFromEvent：一条事件只会产出一条记录', () => {
  const message = assistantMessage({
    usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })
  assert.equal(recordsFromEvent('s', message, pricing).length, 1)
  const tool = { type: 'tool/call', seq: 3, time: Date.now(), data: { name: 'web_search', arguments: '{"queries":["x"]}' } }
  assert.equal(recordsFromEvent('s', tool, pricing).length, 1)
  assert.equal(recordsFromEvent('s', { type: 'step/end', seq: 4, data: {} }, pricing).length, 0)
})

test('foldSessionEvents 同时折出用量记录与按次费用记录', () => {
  const events = [
    assistantMessage({
      seq: 1,
      time: Date.UTC(2026, 10, 12, 2, 0),
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    { type: 'tool/call', seq: 2, time: Date.UTC(2026, 10, 12, 2, 1), data: { name: 'web_fetch', arguments: '{"url":"https://x"}' } },
  ]
  const { records } = foldSessionEvents('s', events, pricing)
  assert.equal(records.length, 2)
  assert.equal(records.filter((record) => record.kind === 'fee').length, 1)
})

test('峰谷标记随事件时间变化', () => {
  const peak = recordFromEvent(
    's',
    assistantMessage({
      time: Date.UTC(2026, 10, 12, 2, 0),
      usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    pricing,
  )
  const valley = recordFromEvent(
    's',
    assistantMessage({
      time: Date.UTC(2026, 10, 12, 7, 0) - BEIJING_OFFSET_MS + BEIJING_OFFSET_MS, // 北京时间 15:00 -> 峰; 用 20:00 谷
      usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    pricing,
  )
  assert.equal(peak.pk, 1)
  assert.equal(valley.pk, 1, '15:00 仍是峰时')
  const night = recordFromEvent(
    's',
    assistantMessage({
      time: Date.UTC(2026, 10, 12, 12, 0) - BEIJING_OFFSET_MS,
      usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
    pricing,
  )
  assert.equal(night.pk, 0, '北京时间 20:00 是谷时')
})
