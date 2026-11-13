/**
 * dsh-usage-analytics · 会话事件 → 用量记录
 *
 * 唯一数据来源是已提交的会话事件：`assistant/message` 事件带 `usage`（TokenUsage）
 * 和 `message.source`（provider/model），这就是一步的真实计费数据。
 *
 * 记录字段（为落盘体积压缩过命名）：
 *   sid  会话 id          seq  事件序号（去重键）      turn/step  轮次/步
 *   t    时间戳(ms)       pr   provider                m   模型
 *   i    输入(未命中)     o    输出                    cr  缓存命中读取
 *   cw   缓存写入         cost 成本(元)                pk  1=峰时 0=谷时
 */
import { toNonNegativeInt } from './util.js'
import { PRICE_TABLE_VERSION } from './pricing.js'

/** 从事件里取 provider / model。 */
function routeOf(event) {
  const source = event?.data?.message?.source
  const usage = event?.data?.usage
  if (!usage) return null
  const provider = typeof source?.provider === 'string' && source.provider ? source.provider : 'unknown'
  const model = typeof source?.model === 'string' && source.model ? source.model : 'unknown'
  return { provider, model }
}

/**
 * 一条 `assistant/message` 事件 → 一条用量记录；没有 usage 时返回 null。
 * @param {string} sid
 * @param {object} event SessionEvent
 * @param {{costOf: Function, isPeak: Function}} pricing
 */
export function recordFromEvent(sid, event, pricing) {
  if (!event || event.type !== 'assistant/message') return null
  const usage = event.data?.usage
  if (!usage) return null
  const route = routeOf(event)
  if (!route) return null
  const time = toNonNegativeInt(event.time)
  const record = {
    sid: String(sid),
    seq: toNonNegativeInt(event.seq),
    turn: toNonNegativeInt(event.data?.turn),
    step: toNonNegativeInt(event.data?.step),
    t: time,
    pr: route.provider,
    m: route.model,
    i: toNonNegativeInt(usage.inputTokens),
    o: toNonNegativeInt(usage.outputTokens),
    cr: toNonNegativeInt(usage.cacheReadTokens),
    cw: toNonNegativeInt(usage.cacheWriteTokens),
    cost: 0,
    pk: pricing.isPeak(time) ? 1 : 0,
    pv: PRICE_TABLE_VERSION,
  }
  record.cost = pricing.costOf(usage, record.m, time)
  return record
}

/**
 * 折叠一个会话的全部事件。
 * @param {string} sid
 * @param {readonly object[]} events
 * @param {object} pricing
 * @param {number} [sinceSeq] 只保留 seq 大于该值的事件（用于增量回填）
 * @returns {{ records: object[], lastSeq: number }}
 */
export function foldSessionEvents(sid, events, pricing, sinceSeq = -1) {
  const records = []
  let lastSeq = sinceSeq
  for (const event of events ?? []) {
    const seq = toNonNegativeInt(event?.seq)
    if (seq > lastSeq) lastSeq = seq
    if (seq <= sinceSeq) continue
    const record = recordFromEvent(sid, event, pricing)
    if (record) records.push(record)
  }
  return { records, lastSeq }
}

/** 记录去重键。 */
export function recordKey(record) {
  return `${record.sid}#${record.seq}`
}

/** 从会话 header 提取展示用元信息。 */
export function sessionMetaFromHeader(header, sid, label) {
  const createdAt = toNonNegativeInt(header?.createdAt)
  return {
    label,
    origin: typeof header?.origin === 'string' ? header.origin : 'root',
    createdAt,
    createdAtText: createdAt > 0 ? new Date(createdAt).toISOString() : null,
  }
}
