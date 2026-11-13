/**
 * dsh-usage-analytics · Host 入口
 *
 * 职责：
 *   1. 采集：监听 `session/event` 的 `assistant/message`（带 usage）实时记账；
 *   2. 回填：用 `sessionPersistence` 把已落盘的会话日志补成历史记录（跨会话、跨重启）；
 *   3. 存储：`<DSH_HOME>/storages/usage-analytics.jsonl` + meta 水位；
 *   4. 服务：`/usage-dashboard/api/*` 给输入框坞与「用量分析」面板读数据，另代理账户余额。
 *
 * 计费口径见 lib/pricing.js；聚合见 lib/aggregate.js。
 */
import nodePath from 'node:path'
import { createHandler } from './lib/api.js'
import { createPricing } from './lib/pricing.js'
import { createStore, prepareFoldVersion } from './lib/store.js'
import { createSync } from './lib/sync.js'
import { FOLD_VERSION, recordsFromEvent } from './lib/scan.js'
import { resolveStorageDir, sessionLabel } from './lib/util.js'

export const name = 'dsh-usage-analytics'

/** 采集依赖会话持久化；HTTP 面依赖 webServer。 */
export const inject = ['webServer', 'sessionPersistence']

export function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  const debug = cfg.debug === true
  const log = (...args) => {
    if (debug) console.log('[usage-analytics]', ...args)
  }
  const historyLimit = Number.isFinite(Number(cfg.historyLimit)) ? Math.max(1000, Math.round(Number(cfg.historyLimit))) : 40000

  // storageDir（目录）与 storagePath（文件路径，README 文档化写法）二选一。
  let storageDir = cfg.storageDir
  if (!storageDir && typeof cfg.storagePath === 'string' && cfg.storagePath.trim()) {
    const raw = cfg.storagePath.trim()
    if (raw.toLowerCase().endsWith('.jsonl')) {
      storageDir = nodePath.dirname(raw)
    } else {
      storageDir = raw
    }
  }

  const store = createStore({
    dir: resolveStorageDir(storageDir),
    cap: historyLimit,
    debug,
  })
  const pricing = createPricing(cfg)
  const sync = createSync({ ctx, store, pricing, log })
  const handler = createHandler({ ctx, store, pricing, sync, config: cfg, log })

  const ready = store.load({
    // 价格表版本升级后，历史记录按新价格重算一次并写回文件；
    // token 数、时间、模型都还在记录里，重算不需要重读会话日志。
    reprice: (record) => {
      if (record.pv === pricing.version) return null
      const time = Number(record.t) || 0
      return {
        cost: pricing.costOf(record, record.m, time),
        pk: pricing.isPeak(time) ? 1 : 0,
        pv: pricing.version,
      }
    },
  }).then(() => {
    // 折叠逻辑升级（例如新增按次费用记录）：重置回填水位，让下一轮 sync 重扫会话日志。
    // 旧记录按 sid#seq 去重，不会被重复计入；只会补出新类型的记录。
    if (prepareFoldVersion(store, FOLD_VERSION)) {
      log(`fold version -> ${FOLD_VERSION}: backfill watermarks reset for a full re-scan`)
    }
  }).catch((error) => {
    console.error('[usage-analytics] 载入历史失败：', error)
  })

  // ---------- HTTP ----------
  try {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: '/usage-dashboard',
          handler,
        }),
      'usage-analytics: http routes',
    )
    log('http routes registered at /usage-dashboard')
  } catch (error) {
    console.error('[usage-analytics] 注册 HTTP 路由失败：', error)
  }

  // ---------- 实时采集 ----------
  try {
    ctx.effect(
      () =>
        ctx.on('session/event', (session, event) => {
          try {
            if (!event) return
            // 用量：assistant/message；按次计费：web_search / web_fetch 的 tool/call
            if (event.type !== 'assistant/message' && event.type !== 'tool/call') return
            const sid = String(session?.id ?? session?.header?.id ?? '')
            if (!sid) return
            const records = recordsFromEvent(sid, event, pricing)
            if (records.length === 0) return
            store.append(records)
            const record = records[records.length - 1]
            // 注意：这里不推进回填水位 seq——水位只由回填推进，避免实时事件把
            // 「插件启动前就提交、但还没回填的事件」永久跳过。
            const meta = store.sessionMeta(sid)
            if (!meta) {
              store.updateSessionMeta(sid, {
                label: sessionLabel(session?.header, sid),
                origin: session?.header?.origin === 'subagent' ? 'subagent' : 'root',
                createdAt: Number(session?.header?.createdAt) || 0,
                lastAt: record.t,
              })
            } else if (record.t > (Number(meta.lastAt) || 0)) {
              store.updateSessionMeta(sid, { lastAt: record.t })
            }
          } catch (error) {
            log(`live capture failed: ${String(error)}`)
          }
        }),
      'usage-analytics: live capture',
    )
  } catch (error) {
    console.error('[usage-analytics] 注册实时采集失败：', error)
  }

  // ---------- 启动预热 + 周期回填 ----------
  try {
    ctx.effect(() => {
      const warm = setTimeout(() => {
        void ready
          .then(() => sync.ensure({ maxMs: 60000 }))
          .then((result) => log('warm sync', result))
          .catch((error) => log(`warm sync failed: ${String(error)}`))
      }, 2500)
      return () => clearTimeout(warm)
    }, 'usage-analytics: warm-up')

    ctx.effect(() => {
      // 60 秒一次增量回填，让面板里的 Token / 成本尽快追上平台（平台本身有 ~5 分钟延迟）。
      const timer = setInterval(() => {
        void ready
          .then(() => sync.ensure({ maxMs: 8000, minIntervalMs: 45000 }))
          .catch(() => {})
      }, 60000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    }, 'usage-analytics: periodic sync')
  } catch {
    /* 预热/周期任务失败不影响主功能 */
  }

  // ---------- 卸载时把未落盘的记录刷出去 ----------
  try {
    ctx.effect(() => async () => {
      try {
        await store.flush()
      } catch (error) {
        console.error('[usage-analytics] 卸载时落盘失败：', error)
      }
    }, 'usage-analytics: flush')
  } catch {
    /* ignore */
  }

  log('ready', `storageDir=${store.dir}`)
}
