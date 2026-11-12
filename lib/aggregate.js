/**
 * dsh-usage-analytics · 聚合
 *
 * 把落盘的用量记录按筛选条件（时间范围 / 会话 / 模型 / 单日）折叠成面板要的
 * 一次性快照。纯函数，不做 I/O，方便单测。
 */
import { BEIJING_OFFSET_MS, DAY_MS } from './pricing.js'

const HOUR_MS = 3_600_000

/** 北京时间某天的 00:00 对应的 UTC 毫秒。 */
export function beijingDayStart(timeMs) {
  const shifted = Number(timeMs) + BEIJING_OFFSET_MS
  return Math.floor(shifted / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS
}

/** 北京时间日期字符串 YYYY-MM-DD。 */
export function beijingDateKey(timeMs) {
  const shifted = new Date(Number(timeMs) + BEIJING_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 北京时间小时（0-23）。 */
export function beijingHour(timeMs) {
  return new Date(Number(timeMs) + BEIJING_OFFSET_MS).getUTCHours()
}

/** 解析 YYYY-MM-DD 为北京时间当天 00:00 的 UTC 毫秒；非法返回 null。 */
export function parseDayKey(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const utc = Date.UTC(year, month - 1, day)
  const date = new Date(utc)
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return utc - BEIJING_OFFSET_MS
}

export const RANGE_DAYS = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 0,
}

export function normalizeRange(value) {
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, value) ? value : '7d'
}

function emptyTotals() {
  return {
    cost: 0,
    peakCost: 0,
    valleyCost: 0,
    tokens: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    steps: 0,
    peakSteps: 0,
    valleySteps: 0,
  }
}

function addRecord(totals, record) {
  const tokens = (record.i || 0) + (record.cr || 0) + (record.cw || 0) + (record.o || 0)
  const cost = Number(record.cost) || 0
  totals.cost += cost
  totals.tokens += tokens
  totals.input += record.i || 0
  totals.cacheRead += record.cr || 0
  totals.cacheWrite += record.cw || 0
  totals.output += record.o || 0
  totals.steps += 1
  if (record.pk) {
    totals.peakCost += cost
    totals.peakSteps += 1
  } else {
    totals.valleyCost += cost
    totals.valleySteps += 1
  }
  return tokens
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * @param {object} input
 * @param {object[]} input.records 全部记录
 * @param {object} input.sessionMeta 会话元信息 { [sid]: { label, origin, createdAt } }
 * @param {object} input.pricing createPricing() 的返回值
 * @param {object} [input.filters] { range, session, sid, model, day }
 * @param {number} [input.now]
 */
export function aggregate({ records, sessionMeta = {}, pricing, filters = {}, now = Date.now() }) {
  const range = normalizeRange(filters.range)
  const sessionScope = filters.session === 'current' ? 'current' : 'all'
  const modelFilter = typeof filters.model === 'string' && filters.model !== 'all' ? filters.model : null
  const dayStart = parseDayKey(filters.day)
  const dayKey = dayStart === null ? null : filters.day.trim()

  let from
  let to = now + 1
  if (dayStart !== null) {
    from = dayStart
    to = dayStart + DAY_MS
  } else if (range === 'all') {
    from = 0
  } else {
    from = beijingDayStart(now) - (RANGE_DAYS[range] - 1) * DAY_MS
  }
  const sid = typeof filters.sid === 'string' && filters.sid ? filters.sid : null

  const selected = []
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const t = Number(record.t) || 0
    if (t < from || t >= to) continue
    if (sid && sessionScope === 'current' && record.sid !== sid) continue
    if (modelFilter && record.m !== modelFilter) continue
    selected.push(record)
  }

  const totals = emptyTotals()
  const dayMap = new Map()
  const modelMap = new Map()
  const sessionMap = new Map()
  const turnKeys = new Set()
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, cost: 0, steps: 0, peak: false }))

  const labelOf = (record) => sessionMeta[record.sid]?.label ?? String(record.sid).slice(0, 8)

  for (const record of selected) {
    const tokens = addRecord(totals, record)
    turnKeys.add(`${record.sid}#${record.turn}`)

    const day = dayKey ?? beijingDateKey(record.t)
    let dayEntry = dayMap.get(day)
    if (!dayEntry) {
      dayEntry = { date: day, cost: 0, peakCost: 0, valleyCost: 0, tokens: 0, steps: 0, turns: new Set() }
      dayMap.set(day, dayEntry)
    }
    const cost = Number(record.cost) || 0
    dayEntry.cost += cost
    dayEntry.tokens += tokens
    dayEntry.steps += 1
    dayEntry.turns.add(`${record.sid}#${record.turn}`)
    if (record.pk) dayEntry.peakCost += cost
    else dayEntry.valleyCost += cost

    let modelEntry = modelMap.get(record.m)
    if (!modelEntry) {
      modelEntry = { model: record.m, provider: record.pr, cost: 0, tokens: 0, steps: 0 }
      modelMap.set(record.m, modelEntry)
    }
    modelEntry.cost += cost
    modelEntry.tokens += tokens
    modelEntry.steps += 1

    let sessionEntry = sessionMap.get(record.sid)
    if (!sessionEntry) {
      sessionEntry = {
        sessionId: record.sid,
        label: labelOf(record),
        origin: sessionMeta[record.sid]?.origin ?? 'root',
        cost: 0,
        tokens: 0,
        steps: 0,
        lastAt: 0,
      }
      sessionMap.set(record.sid, sessionEntry)
    }
    sessionEntry.cost += cost
    sessionEntry.tokens += tokens
    sessionEntry.steps += 1
    sessionEntry.lastAt = Math.max(sessionEntry.lastAt, Number(record.t) || 0)

    if (dayKey !== null) {
      const bucket = hourly[beijingHour(record.t)]
      bucket.cost += cost
      bucket.steps += 1
      if (record.pk) bucket.peak = true
    }
  }

  const promptTokens = totals.input + totals.cacheRead
  const cacheHitRate = promptTokens > 0 ? totals.cacheRead / promptTokens : 0

  const days = [...dayMap.values()]
    .map((entry) => ({
      date: entry.date,
      cost: round(entry.cost),
      peakCost: round(entry.peakCost),
      valleyCost: round(entry.valleyCost),
      tokens: entry.tokens,
      steps: entry.steps,
      turns: entry.turns.size,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-120)

  const models = [...modelMap.values()]
    .map((entry) => ({
      ...entry,
      cost: round(entry.cost),
      share: totals.cost > 0 ? entry.cost / totals.cost : 0,
    }))
    .sort((a, b) => b.cost - a.cost)

  const modelTokenMix = models.map((entry) => {
    let input = 0
    let cacheRead = 0
    let cacheWrite = 0
    let output = 0
    for (const record of selected) {
      if (record.m !== entry.model) continue
      input += record.i || 0
      cacheRead += record.cr || 0
      cacheWrite += record.cw || 0
      output += record.o || 0
    }
    return { model: entry.model, input, cacheRead, cacheWrite, output, cost: entry.cost }
  })

  const sessions = [...sessionMap.values()]
    .map((entry) => ({ ...entry, cost: round(entry.cost) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 50)

  // ---- 最近记录：按 (会话, 轮次) 分组，最近 20 轮 ----
  const sorted = selected.slice().sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))
  const groups = []
  const groupIndex = new Map()
  for (const record of sorted) {
    if (groups.length >= 20 && !groupIndex.has(`${record.sid}#${record.turn}`)) continue
    const key = `${record.sid}#${record.turn}`
    let group = groupIndex.get(key)
    if (!group) {
      group = {
        sessionId: record.sid,
        label: labelOf(record),
        turn: record.turn,
        time: Number(record.t) || 0,
        model: record.m,
        provider: record.pr,
        cost: 0,
        tokens: 0,
        peak: Boolean(record.pk),
        steps: [],
      }
      groupIndex.set(key, group)
      groups.push(group)
    }
    const tokens = (record.i || 0) + (record.cr || 0) + (record.cw || 0) + (record.o || 0)
    group.cost += Number(record.cost) || 0
    group.tokens += tokens
    group.peak = group.peak || Boolean(record.pk)
    group.steps.push(stepView(record, tokens))
  }
  for (const group of groups) {
    group.cost = round(group.cost)
    group.steps.sort((a, b) => a.step - b.step)
  }
  const recent = []
  for (const group of groups) {
    for (const step of group.steps) {
      if (recent.length >= 200) break
      recent.push({
        sessionId: group.sessionId,
        label: group.label,
        turn: group.turn,
        step: step.step,
        time: step.time,
        model: step.model,
        provider: step.provider,
        input: step.input,
        cacheRead: step.cacheRead,
        cacheWrite: step.cacheWrite,
        output: step.output,
        tokens: step.tokens,
        cost: step.cost,
        peak: step.peak,
      })
    }
  }

  const period = pricing.periodAt(now)

  return {
    generatedAt: now,
    range: dayKey !== null ? 'day' : range,
    session: sessionScope,
    model: modelFilter ?? 'all',
    day: dayKey,
    period,
    overview: {
      cost: round(totals.cost),
      peakCost: round(totals.peakCost),
      valleyCost: round(totals.valleyCost),
      savedValley: round(totals.valleyCost),
      tokens: totals.tokens,
      input: totals.input,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      output: totals.output,
      cacheHitRate: round(cacheHitRate, 6),
      turns: turnKeys.size,
      steps: totals.steps,
      peakSteps: totals.peakSteps,
      valleySteps: totals.valleySteps,
      sessions: sessionMap.size,
      avgCostPerStep: totals.steps > 0 ? round(totals.cost / totals.steps, 6) : 0,
      avgTokensPerStep: totals.steps > 0 ? Math.round(totals.tokens / totals.steps) : 0,
      firstTokenMs: null,
      firstTokenSteps: 0,
      llmMs: null,
      toolMs: null,
      outputTps: null,
    },
    days,
    models,
    tokenMix: {
      input: totals.input,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      output: totals.output,
    },
    modelTokenMix,
    hourly: dayKey !== null ? hourly.map((bucket) => ({ ...bucket, cost: round(bucket.cost) })) : [],
    sessions,
    groups,
    recent,
    filters: {
      range: dayKey !== null ? 'day' : range,
      from,
      to,
      session: sessionScope,
      sid,
      model: modelFilter ?? 'all',
      day: dayKey,
    },
  }
}

function stepView(record, tokens) {
  return {
    step: record.step,
    time: Number(record.t) || 0,
    model: record.m,
    provider: record.pr,
    input: record.i || 0,
    cacheRead: record.cr || 0,
    cacheWrite: record.cw || 0,
    output: record.o || 0,
    tokens,
    cost: round(Number(record.cost) || 0),
    peak: Boolean(record.pk),
  }
}

/** 单会话（含当前轮次）的实时汇总，供输入框坞使用。 */
export function liveSummary({ records, sid, now = Date.now() }) {
  let session = null
  let turn = null
  if (sid) {
    let cost = 0
    let tokens = 0
    let steps = 0
    let lastTurn = -1
    const turnMap = new Map()
    for (const record of records) {
      if (record.sid !== sid) continue
      const recordTokens = (record.i || 0) + (record.cr || 0) + (record.cw || 0) + (record.o || 0)
      cost += Number(record.cost) || 0
      tokens += recordTokens
      steps += 1
      const turnNo = Number(record.turn) || 0
      if (turnNo > lastTurn) lastTurn = turnNo
      const entry = turnMap.get(turnNo) ?? { cost: 0, tokens: 0, steps: 0 }
      entry.cost += Number(record.cost) || 0
      entry.tokens += recordTokens
      entry.steps += 1
      turnMap.set(turnNo, entry)
    }
    session = { cost: round(cost), tokens, steps, turns: turnMap.size }
    const latest = turnMap.get(lastTurn)
    turn = latest
      ? { turn: lastTurn, cost: round(latest.cost), tokens: latest.tokens, steps: latest.steps }
      : null
  }
  return { now, session, turn }
}
