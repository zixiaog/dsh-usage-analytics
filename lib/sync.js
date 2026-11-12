/**
 * dsh-usage-analytics · 历史回填
 *
 * 面板要「跨会话、跨重启」的数据，而事件监听只能拿到启动之后的新事件，
 * 所以启动后（以及每次手动刷新时）用 sessionPersistence 把落盘日志补一遍：
 *   1. list() 拿到每个会话的 snapshot（含 revision / eventCount）；
 *   2. 水位没变就跳过（同 revision 且已回填到末尾）；
 *   3. 否则 open(id,'read') 读取 seq 之后的事件，折叠成用量记录追加进存储。
 *
 * revision 与 seq 水位双保险：revision 变了但 eventCount 没涨（例如被压缩重写）时
 * 也不会重复读取；seq 水位保证崩溃后再次回填不重复计费。
 */
import { foldSessionEvents, sessionMetaFromHeader } from './scan.js'
import { sessionLabel } from './util.js'

export function createSync({ ctx, store, pricing, log }) {
  const revisions = new Map()
  let inFlight = null
  let lastSyncAt = 0
  let lastAdded = 0
  let lastErrors = []

  async function syncOnce(options = {}) {
    const force = options.force === true
    const maxMs = Number.isFinite(Number(options.maxMs)) ? Number(options.maxMs) : 5000
    const started = Date.now()
    lastErrors = []
    let added = 0
    let scanned = 0
    let skipped = 0

    const snapshots = await ctx.sessionPersistence.list()
    for (const snapshot of snapshots) {
      if (!force && Date.now() - started > maxMs) {
        log(`sync budget ${maxMs}ms exhausted after ${scanned} sessions`)
        break
      }
      const header = snapshot?.header
      const sid = header?.id
      if (!sid) continue
      const count = Number(snapshot.eventCount ?? 0)
      const meta = store.sessionMeta(sid) ?? {}
      const watermark = Number.isFinite(Number(meta.seq)) ? Number(meta.seq) : -1
      const sameRevision = revisions.get(sid) === snapshot.revision
      if (sameRevision && watermark >= count - 1) {
        skipped += 1
        continue
      }
      scanned += 1
      try {
        const handle = await ctx.sessionPersistence.open(sid, 'read')
        try {
          const result = await handle.read(watermark + 1)
          const events = result?.events ?? []
          const folded = foldSessionEvents(sid, events, pricing, watermark)
          if (folded.records.length > 0) added += store.append(folded.records)
          const base = sessionMetaFromHeader(header, sid, sessionLabel(header, sid))
          store.updateSessionMeta(sid, {
            ...base,
            seq: Math.max(watermark, folded.lastSeq),
            eventCount: count,
            lastAt: folded.records.length > 0 ? folded.records[folded.records.length - 1].t : meta.lastAt ?? 0,
          })
        } finally {
          await handle.close()
        }
        revisions.set(sid, snapshot.revision)
      } catch (error) {
        lastErrors.push({ sessionId: String(sid), error: String(error?.message ?? error) })
        log(`sync session ${sid} failed: ${String(error)}`)
      }
    }

    lastSyncAt = Date.now()
    lastAdded = added
    return { added, scanned, skipped, total: snapshots.length, errors: lastErrors, tookMs: Date.now() - started }
  }

  /** 串行化的同步：同一时间只有一个回填在跑，并带一个最短间隔节流。 */
  function ensure(options = {}) {
    if (inFlight) return inFlight
    const minInterval = Number.isFinite(Number(options.minIntervalMs)) ? Number(options.minIntervalMs) : 15000
    if (options.force !== true && Date.now() - lastSyncAt < minInterval) {
      return Promise.resolve({ added: 0, scanned: 0, skipped: 0, total: 0, errors: lastErrors, tookMs: 0, throttled: true })
    }
    inFlight = syncOnce(options).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    ensure,
    get lastSyncAt() {
      return lastSyncAt
    },
    get lastAdded() {
      return lastAdded
    },
    get lastErrors() {
      return lastErrors
    },
  }
}
