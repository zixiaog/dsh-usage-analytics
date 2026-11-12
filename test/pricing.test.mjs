import test from 'node:test'
import assert from 'node:assert/strict'
import { createPricing, BEIJING_OFFSET_MS, DEFAULT_PEAK_WINDOWS } from '../lib/pricing.js'

/** 构造北京时间某个时刻的 UTC 毫秒。 */
function beijingTime(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute) - BEIJING_OFFSET_MS
}

test('峰时窗口：工作日上午/下午为峰，午休与夜间为谷', () => {
  const pricing = createPricing()
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 10, 0)), true, '周三 10:00 应为峰时')
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 15, 0)), true, '周三 15:00 应为峰时')
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 9, 0)), true, '09:00 含在峰时[9,12)内')
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 12, 0)), false, '12:00 已进入谷时')
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 13, 30)), false, '午休谷时')
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 18, 0)), false, '18:00 之后谷时')
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 12, 3, 0)), false, '凌晨谷时')
})

test('峰时窗口：周末全天谷时', () => {
  const pricing = createPricing()
  // 2026-11-14 是周六
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 14, 10, 0)), false)
  assert.equal(pricing.isPeak(beijingTime(2026, 11, 15, 15, 0)), false)
})

test('价格匹配：精确 > 最长前缀 > 语义回退', () => {
  const pricing = createPricing()
  assert.equal(pricing.priceFor('deepseek-v4-pro').output, 16)
  assert.equal(pricing.priceFor('deepseek-v4-pro-2026').output, 16, '前缀匹配')
  assert.equal(pricing.priceFor('some-reasoner-model').output, 16, 'reasoner 回退')
  assert.equal(pricing.priceFor('some-flash-model').output, 8, 'flash 回退')
  assert.equal(pricing.priceFor('unknown-model').output, 8, '默认档')
})

test('成本：谷时是峰时的一半，缓存命中按命中价', () => {
  const pricing = createPricing()
  const usage = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 1_000_000 }
  const peakTime = beijingTime(2026, 11, 12, 10, 0)
  const valleyTime = beijingTime(2026, 11, 12, 3, 0)
  const peakCost = pricing.costOf(usage, 'deepseek-v4-pro', peakTime)
  const valleyCost = pricing.costOf(usage, 'deepseek-v4-pro', valleyTime)
  assert.equal(peakCost, 4 + 1 + 16)
  assert.equal(valleyCost, (4 + 1 + 16) / 2)
})

test('config.prices 覆盖默认价格表', () => {
  const pricing = createPricing({ prices: { 'my-model': { input: 10, cacheRead: 1, cacheWrite: 10, output: 20 } } })
  const cost = pricing.costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'my-model', beijingTime(2026, 11, 14, 3, 0))
  assert.equal(cost, (10 + 20) / 2, '周末谷时半价')
})

test('periodAt：返回当前时段、进度与下一次切换点', () => {
  const pricing = createPricing()
  const now = beijingTime(2026, 11, 12, 10, 30)
  const period = pricing.periodAt(now)
  assert.equal(period.kind, 'peak')
  assert.ok(period.progress > 0 && period.progress < 1)
  assert.ok(period.nextAt > now)
  // 10:30 之后的下一次切换是 12:00（谷时开始）
  assert.equal(period.nextAt, beijingTime(2026, 11, 12, 12, 0))
  const valley = pricing.periodAt(beijingTime(2026, 11, 12, 13, 0))
  assert.equal(valley.kind, 'valley')
  assert.equal(valley.nextAt, beijingTime(2026, 11, 12, 14, 0), '午休后 14:00 回峰时')
})

test('periodAt：周五晚到周一早是一整段谷时', () => {
  const pricing = createPricing()
  const fridayEvening = pricing.periodAt(beijingTime(2026, 11, 13, 20, 0))
  assert.equal(fridayEvening.kind, 'valley')
  assert.equal(fridayEvening.nextAt, beijingTime(2026, 11, 16, 9, 0), '周一 09:00 才回峰时')
})

test('默认峰时窗口为 09-12 / 14-18', () => {
  assert.deepEqual(DEFAULT_PEAK_WINDOWS, [[540, 720], [840, 1080]])
})
