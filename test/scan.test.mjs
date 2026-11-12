import test from 'node:test'
import assert from 'node:assert/strict'
import { recordFromEvent, foldSessionEvents, recordKey } from '../lib/scan.js'
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
