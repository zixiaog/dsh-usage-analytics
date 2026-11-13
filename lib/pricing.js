/**
 * dsh-usage-analytics · 计价与峰谷
 *
 * 计费口径（与 DeepSeek 平台一致的部分）：
 *   - inputTokens 是「未命中缓存的输入」，cacheReadTokens 是「命中缓存的输入」，
 *     cacheWriteTokens 是「写入缓存的输入」，outputTokens 是输出。
 *   - 价格单位：元 / 百万 tokens。
 *   - 峰时全价；谷时按 valleyFactor（默认 0.5，即半价）。
 *
 * 峰谷规则（北京时间 UTC+8，无夏令时）：
 *   - 周一~周五 09:00–12:00、14:00–18:00 为峰时；
 *   - 其余时间、以及周六周日全天为谷时。
 *
 * 价格表是**估算默认值**，用户可以在插件 config.prices 里按模型覆盖；
 * 平台调价后改默认表即可，不影响历史聚合（历史成本在采集时已写入）。
 */
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const BEIJING_OFFSET_MS = 8 * HOUR_MS

export const DEFAULT_PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/** 峰时工作日：1=周一 … 5=周五（与 Date#getUTCDay 对齐）。 */
export const DEFAULT_PEAK_DAYS = [1, 2, 3, 4, 5]

/**
 * 官方价格快照：https://api-docs.deepseek.com/quick_start/pricing
 * 单位：元 / 百万 tokens（**峰时价**；谷时按 valleyFactor=0.5 计）。
 *
 * 几个容易算错的地方：
 *   - 缓存命中价远低于缓存未命中价（flash 是 0.04 对 2），它是成本大头；
 *   - DeepSeek 不单独收「缓存写入」费，命中/未命中已经覆盖，cacheWrite 记 0；
 *   - 官方高峰时段是北京时间工作日 9:00–12:00、14:00–18:00，且**排除法定节假日**。
 */
export const PRICE_TABLE_VERSION = '2026-11-13.official'

export const DEFAULT_PRICE_TABLE = {
  'deepseek-flash': { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  'deepseek-v4-flash': { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  'deepseek-v4-flash-vision-exp': { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  'deepseek-v4-pro': { input: 9, cacheRead: 0.3, cacheWrite: 0, output: 27 },
  // 已下线的旧模型名：按同档位近似，用户可在 config.prices 里精确覆盖。
  'deepseek-chat': { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  'deepseek-reasoner': { input: 9, cacheRead: 0.3, cacheWrite: 0, output: 27 },
  default: { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
}

/**
 * 搜索 / 抓取按次计费：官方 ¥5 / 1000 次成功请求 = ¥0.005/次，不分峰谷。
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 */
export const DEFAULT_FEE_PRICES = {
  search: 0.005,
  fetch: 0.005,
}

function normalizeWindow(value) {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [start, end] = value
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 * 60 || start >= end) return null
  return [start, end]
}

/** 接受 "HH:MM-HH:MM" 文本窗口（README 里文档化的写法）。 */
function parseHourWindow(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const start = Number(match[1]) * 60 + Number(match[2])
  const end = Number(match[3]) * 60 + Number(match[4])
  return normalizeWindow([start, end])
}

function resolveWindows(config) {
  if (Array.isArray(config.peakWindows)) {
    const windows = config.peakWindows.map(normalizeWindow).filter(Boolean)
    if (windows.length > 0) return windows
  }
  if (Array.isArray(config.peakHours)) {
    const windows = config.peakHours.map(parseHourWindow).filter(Boolean)
    if (windows.length > 0) return windows
  }
  return DEFAULT_PEAK_WINDOWS
}

function normalizePrices(table) {
  const out = {}
  if (table && typeof table === 'object') {
    for (const [key, value] of Object.entries(table)) {
      if (!value || typeof value !== 'object') continue
      out[key] = {
        input: Math.max(0, Number(value.input) || 0),
        cacheRead: Math.max(0, Number(value.cacheRead) || 0),
        cacheWrite: Math.max(0, Number(value.cacheWrite) || 0),
        output: Math.max(0, Number(value.output) || 0),
      }
    }
  }
  return out
}

/**
 * @param {object} [config]
 * @param {object} [config.prices] 按模型覆盖价格
 * @param {Array<[number, number]>} [config.peakWindows] 峰时分钟窗口
 * @param {number[]} [config.peakDays] 峰时星期
 * @param {number} [config.valleyFactor] 谷时折扣系数
 * @param {string[]} [config.offPeakDates] 全天算谷时的日期（YYYY-MM-DD，北京时间；用于法定节假日）
 * @param {string} [config.timeZone] 预留：目前实现固定按北京时间
 */
export function createPricing(config = {}) {
  const priceTable = { ...DEFAULT_PRICE_TABLE, ...normalizePrices(config.prices) }
  const windows = resolveWindows(config)
  const peakDays = new Set(
    (Array.isArray(config.peakDays) ? config.peakDays : DEFAULT_PEAK_DAYS).map((d) => Math.round(Number(d))),
  )
  const offPeakDates = new Set(
    (Array.isArray(config.offPeakDates) ? config.offPeakDates : [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim()),
  )
  const valleyFactor = Number.isFinite(Number(config.valleyFactor))
    ? Math.min(1, Math.max(0, Number(config.valleyFactor)))
    : 0.5
  const feePrices = {
    search: Number.isFinite(Number(config.searchPerRequest)) ? Math.max(0, Number(config.searchPerRequest)) : DEFAULT_FEE_PRICES.search,
    fetch: Number.isFinite(Number(config.fetchPerRequest)) ? Math.max(0, Number(config.fetchPerRequest)) : DEFAULT_FEE_PRICES.fetch,
  }

  /** 搜索 / 抓取费（元）：按请求次数，不分峰谷。 */
  function feeCostOf(kind, units) {
    const price = feePrices[kind] ?? 0
    const count = Math.max(0, Number(units) || 0)
    return count * price
  }

  /** 北京时间视角的 { day, minutes, date }。 */
  function beijingParts(timeMs) {
    const shifted = new Date(Number(timeMs) + BEIJING_OFFSET_MS)
    const year = shifted.getUTCFullYear()
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
    const day = String(shifted.getUTCDate()).padStart(2, '0')
    return {
      day: shifted.getUTCDay(),
      minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
      date: `${year}-${month}-${day}`,
    }
  }

  function isPeak(timeMs) {
    const { day, minutes, date } = beijingParts(timeMs)
    if (offPeakDates.has(date)) return false
    if (!peakDays.has(day)) return false
    return windows.some(([start, end]) => minutes >= start && minutes < end)
  }

  function priceFor(model) {
    const name = String(model ?? '').toLowerCase()
    if (name && priceTable[name]) return priceTable[name]
    // 最长前缀匹配，保证 v4-pro / v4-flash 一类衍生模型能落到同一档。
    let best = null
    for (const key of Object.keys(priceTable)) {
      if (key === 'default') continue
      if (name.startsWith(key) && (best === null || key.length > best.length)) best = key
    }
    if (best) return priceTable[best]
    if (name.includes('reasoner') || name.includes('pro')) return priceTable['deepseek-reasoner'] ?? priceTable.default
    if (name.includes('flash') || name.includes('chat')) return priceTable['deepseek-chat'] ?? priceTable.default
    return priceTable.default ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  }

  /**
   * 一步的成本（元）。usage 既接受 TokenUsage（inputTokens…），
   * 也接受落盘记录里的短字段（i / cr / cw / o），回填重算时两种都能用。
   */
  function costOf(usage, model, timeMs) {
    const price = priceFor(model)
    const input = Number(usage?.inputTokens ?? usage?.i) || 0
    const cacheRead = Number(usage?.cacheReadTokens ?? usage?.cr) || 0
    const cacheWrite = Number(usage?.cacheWriteTokens ?? usage?.cw) || 0
    const output = Number(usage?.outputTokens ?? usage?.o) || 0
    const full =
      (input * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + output * price.output) / 1_000_000
    return full * (isPeak(timeMs) ? 1 : valleyFactor)
  }

  /**
   * 当前时段信息，供坞上的进度条与倒计时使用。
   * 返回 { kind, start, end, progress, nextAt }，全部是毫秒时间戳。
   */
  function periodAt(nowMs = Date.now()) {
    const now = Number(nowMs)
    const peak = isPeak(now)
    // 以分钟为粒度向后找切换点（最多 4 天，足够覆盖周五晚到周一早）。
    const minute = 60_000
    const alignedNow = Math.floor(now / minute) * minute
    let cursor = alignedNow
    let guard = 0
    while (isPeak(cursor) === peak && guard < 4 * 24 * 60) {
      cursor += minute
      guard += 1
    }
    const end = cursor
    let back = alignedNow
    guard = 0
    while (guard < 4 * 24 * 60) {
      const previous = back - minute
      if (isPeak(previous) !== peak) break
      back = previous
      guard += 1
    }
    const start = back
    const span = Math.max(1, end - start)
    return {
      kind: peak ? 'peak' : 'valley',
      start,
      end,
      progress: Math.min(1, Math.max(0, (now - start) / span)),
      nextAt: end,
    }
  }

  return {
    version: PRICE_TABLE_VERSION,
    valleyFactor,
    feePrices,
    feeCostOf,
    isPeak,
    priceFor,
    costOf,
    periodAt,
    peakWindows: windows,
    peakDays: [...peakDays],
    offPeakDates: [...offPeakDates],
  }
}
