/**
 * dsh-usage-analytics · Host HTTP API
 *
 * 路由（挂在 /usage-dashboard 前缀下，与客户端同源，无需额外鉴权）：
 *   GET  /usage-dashboard/api/summary?range=&session=&sid=&model=&day=&refresh=
 *   GET  /usage-dashboard/api/live?sid=
 *   GET  /usage-dashboard/api/balance
 *   GET  /usage-dashboard/api/health
 *   POST /usage-dashboard/api/sync
 *
 * 余额走 ctx.deepseekAccount.getBalance()，账号未登录时返回 { ok:false }，面板显示「—」。
 */
import { aggregate, liveSummary } from './aggregate.js'

export function createHandler({ ctx, store, pricing, sync, config, log }) {
  const balanceCache = { at: 0, value: null }
  const balanceTtlMs = 60_000
  /** 最近的请求（诊断用，/api/health 里能看到的最近 8 条）。 */
  const recentRequests = []

  function noteRequest(url) {
    try {
      recentRequests.push({ at: Date.now(), path: url.pathname, query: url.search.slice(0, 200) })
      if (recentRequests.length > 8) recentRequests.shift()
    } catch {
      /* ignore */
    }
  }

  /** 余额是平台返回的高精度字符串，展示层只保留最多 4 位小数并去掉尾零。 */
  function formatBalance(value) {
    const raw = typeof value === 'string' ? value.trim() : String(value ?? '')
    const numeric = Number(raw)
    if (!Number.isFinite(numeric)) return raw || null
    const fixed = numeric.toFixed(4).replace(/\.?0+$/, '')
    return fixed === '' || fixed === '-' ? '0' : fixed
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  async function ensureData(force) {
    await store.load()
    try {
      await sync.ensure({ force, maxMs: Number(config.syncBudgetMs) || 4000 })
    } catch (error) {
      log(`sync failed: ${String(error)}`)
    }
  }

  async function readBalance() {
    const now = Date.now()
    if (balanceCache.value && now - balanceCache.at < balanceTtlMs) return balanceCache.value
    let payload
    try {
      const account = ctx.get('deepseekAccount')
      if (!account) {
        payload = { ok: false, reason: 'account-service-unavailable' }
      } else {
        const client = {
          version: config.clientVersion ?? '0.1.0',
          locale: 'zh',
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        }
        const balance = await account.getBalance(client)
        if (!balance || balance.status !== 'ready') {
          payload = { ok: false, reason: balance?.status === 'failed' ? 'query-failed' : 'signed-out' }
        } else {
          const wallets = Array.isArray(balance.value) ? balance.value : []
          const primary = wallets.find((wallet) => wallet?.currency === 'CNY') ?? wallets[0] ?? null
          payload = {
            ok: Boolean(primary),
            currency: primary?.currency ?? 'CNY',
            total: formatBalance(primary?.balance),
            wallets: wallets.map((wallet) => ({ currency: wallet?.currency, balance: formatBalance(wallet?.balance) })),
            bonusWallets: (Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []).map((wallet) => ({
              currency: wallet?.currency,
              balance: formatBalance(wallet?.balance),
            })),
            available: true,
            fetchedAt: now,
          }
        }
      }
    } catch (error) {
      payload = { ok: false, reason: String(error?.message ?? error) }
    }
    balanceCache.value = payload
    balanceCache.at = now
    return payload
  }

  async function summary(url) {
    await ensureData(url.searchParams.get('refresh') === '1')
    const data = aggregate({
      records: store.records,
      sessionMeta: store.meta.sessions,
      pricing,
      filters: {
        range: url.searchParams.get('range') ?? '7d',
        session: url.searchParams.get('session') ?? 'all',
        sid: url.searchParams.get('sid') ?? '',
        model: url.searchParams.get('model') ?? 'all',
        day: url.searchParams.get('day') ?? '',
      },
      now: Date.now(),
    })
    data.sync = {
      lastSyncAt: sync.lastSyncAt,
      lastAdded: sync.lastAdded,
      errors: sync.lastErrors.slice(0, 5),
    }
    data.storage = { records: store.records.length, cap: config.historyLimit ?? 40000 }
    data.errors = store.errors.slice(-5)
    return data
  }

  async function live(url) {
    await ensureData(false)
    const sid = url.searchParams.get('sid') ?? ''
    const data = liveSummary({ records: store.records, sid, now: Date.now() })
    const period = pricing.periodAt(data.now)
    data.peak = period.kind === 'peak'
    data.period = {
      ...period,
      label: period.kind === 'peak' ? '峰时' : '谷时',
      nextLabel: period.kind === 'peak' ? '谷时' : '峰时',
    }
    return data
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const pathname = url.pathname
      const method = req.method ?? 'GET'
      noteRequest(url)

      if (!pathname.startsWith('/usage-dashboard/api/')) {
        sendJson(res, 404, { ok: false, error: 'not-found' })
        return
      }
      const action = pathname.slice('/usage-dashboard/api/'.length)

      if (action === 'health' && method === 'GET') {
        await store.load()
        sendJson(res, 200, {
          ok: true,
          ...store.stats(),
          pricing: {
            version: pricing.version,
            valleyFactor: pricing.valleyFactor,
            peakWindows: pricing.peakWindows,
            offPeakDates: pricing.offPeakDates?.length ?? 0,
          },
          sync: { lastSyncAt: sync.lastSyncAt, lastAdded: sync.lastAdded, errors: sync.lastErrors.slice(0, 5) },
          requests: recentRequests.slice(-8),
          errors: store.errors.slice(-5),
        })
        return
      }
      if (action === 'summary' && method === 'GET') {
        sendJson(res, 200, await summary(url))
        return
      }
      if (action === 'live' && method === 'GET') {
        sendJson(res, 200, await live(url))
        return
      }
      if (action === 'balance' && method === 'GET') {
        sendJson(res, 200, await readBalance())
        return
      }
      if (action === 'sync' && (method === 'POST' || method === 'GET')) {
        await store.load()
        const result = await sync.ensure({ force: true, maxMs: Number(config.syncBudgetMs) || 15000 })
        sendJson(res, 200, { ok: true, ...result })
        return
      }
      sendJson(res, 404, { ok: false, error: 'not-found' })
    } catch (error) {
      log(`api failed: ${String(error)}`)
      try {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      } catch {
        /* 响应可能已开始写出 */
      }
    }
  }
}
