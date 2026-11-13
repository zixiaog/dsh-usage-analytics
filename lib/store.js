/**
 * dsh-usage-analytics · 历史存储
 *
 * 两条落盘文件：
 *   <dir>/usage-analytics.jsonl       每步一行 JSON（软上限 40000 条，超出裁旧）
 *   <dir>/usage-analytics.meta.json   每个会话的回填水位 + 展示标签
 *
 * 设计要点：
 *   - 采集是「事件驱动 + 回填」双通道，靠 `${sid}#${seq}` 去重，重复写入不会重复计费；
 *   - 写入合批（默认 400ms），避免每一步都 fsync 拖慢 agent 循环；
 *   - 裁剪时整体原子重写，保证文件始终是完整 JSONL。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { appendLines, readJsonFile, writeJsonAtomic } from './util.js'
import { recordKey } from './scan.js'

/**
 * 折叠逻辑版本升级后的准备：把所有会话的回填水位重置为 -1，
 * 让下一轮回填重扫会话日志，只补出新类型的记录。返回是否发生了变化。
 * @param {{ meta: any, setMetaFields: Function }} store
 * @param {number} foldVersion 当前代码的 FOLD_VERSION
 */
export function prepareFoldVersion(store, foldVersion) {
  const stored = Number(store.meta.foldVersion) || 0
  if (stored === foldVersion) return false
  for (const sid of Object.keys(store.meta.sessions)) {
    store.meta.sessions[sid] = { ...(store.meta.sessions[sid] ?? {}), seq: -1 }
  }
  store.setMetaFields({ foldVersion })
  return true
}

export function createStore({ dir, cap = 40000, debug = false, now = () => Date.now() }) {
  const recordsFile = path.join(dir, 'usage-analytics.jsonl')
  const metaFile = path.join(dir, 'usage-analytics.meta.json')

  const records = []
  const keys = new Set()
  const meta = { version: 1, sessions: {} }
  const pendingLines = []
  let flushTimer = null
  let metaTimer = null
  let metaDirty = false
  let writing = Promise.resolve()
  let loaded = false
  const errors = []

  const log = (...args) => {
    if (debug) console.log('[usage-analytics]', ...args)
  }

  function trimToCap() {
    if (records.length <= cap) return false
    const dropped = records.splice(0, records.length - cap)
    for (const record of dropped) keys.delete(recordKey(record))
    return true
  }

  async function rewriteAll() {
    await fs.mkdir(dir, { recursive: true })
    const tmp = `${recordsFile}.${process.pid}.tmp`
    const body = records.map((record) => `${JSON.stringify(record)}\n`).join('')
    await fs.writeFile(tmp, body, 'utf8')
    await fs.rename(tmp, recordsFile)
  }

  async function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    const lines = pendingLines.splice(0, pendingLines.length)
    if (lines.length > 0) {
      await appendLines(recordsFile, lines)
    }
    if (metaDirty) {
      metaDirty = false
      await writeJsonAtomic(metaFile, meta)
    }
  }

  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      writing = writing.then(flushNow).catch((error) => {
        errors.push(`flush: ${String(error)}`)
        log('flush failed', error)
      })
    }, 400)
    if (typeof flushTimer.unref === 'function') flushTimer.unref()
  }

  function scheduleMeta() {
    metaDirty = true
    if (metaTimer) return
    metaTimer = setTimeout(() => {
      metaTimer = null
      writing = writing.then(flushNow).catch((error) => {
        errors.push(`meta: ${String(error)}`)
        log('meta flush failed', error)
      })
    }, 800)
    if (typeof metaTimer.unref === 'function') metaTimer.unref()
  }

  /**
   * 读取历史。
   * @param {{ reprice?: (record: object) => object | null }} [options]
   *   reprice 返回补丁时表示该记录需要按新价格重算（例如价格表版本升级），
   *   重算过的记录会整体重写回文件，下次启动不再重复计算。
   */
  async function load(options = {}) {
    if (loaded) return
    loaded = true
    let repriced = 0
    try {
      const text = await fs.readFile(recordsFile, 'utf8')
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        let record
        try {
          record = JSON.parse(line)
        } catch {
          continue
        }
        if (!record || typeof record !== 'object' || !record.sid) continue
        const key = recordKey(record)
        if (keys.has(key)) continue
        if (typeof options.reprice === 'function') {
          const patch = options.reprice(record)
          if (patch) {
            Object.assign(record, patch)
            repriced += 1
          }
        }
        keys.add(key)
        records.push(record)
      }
      const trimmed = trimToCap()
      if (trimmed || repriced > 0) {
        await rewriteAll()
        log(`repriced ${repriced} records`)
      }
      log(`loaded ${records.length} records`)
    } catch (error) {
      if (error?.code !== 'ENOENT') errors.push(`load: ${String(error)}`)
    }
    const savedMeta = await readJsonFile(metaFile, null)
    if (savedMeta && savedMeta.sessions && typeof savedMeta.sessions === 'object') {
      meta.sessions = savedMeta.sessions
    }
    if (savedMeta && Number.isFinite(Number(savedMeta.foldVersion))) {
      meta.foldVersion = Number(savedMeta.foldVersion)
    }
  }

  function append(recordList) {
    let added = 0
    for (const record of recordList) {
      const key = recordKey(record)
      if (keys.has(key)) continue
      keys.add(key)
      records.push(record)
      pendingLines.push(JSON.stringify(record))
      added += 1
    }
    if (added === 0) return 0
    if (records.length > cap) {
      if (trimToCap()) {
        // 裁剪会改变已落盘内容，整体重写一次。
        writing = writing
          .then(flushNow)
          .then(rewriteAll)
          .catch((error) => errors.push(`rewrite: ${String(error)}`))
        return added
      }
    }
    scheduleFlush()
    return added
  }

  function sessionMeta(sid) {
    return meta.sessions[sid]
  }

  function updateSessionMeta(sid, patch) {
    const current = meta.sessions[sid] ?? {}
    meta.sessions[sid] = { ...current, ...patch }
    scheduleMeta()
    return meta.sessions[sid]
  }

  /** 写入 meta 顶层字段（例如 foldVersion），并触发落盘。 */
  function setMetaFields(patch) {
    Object.assign(meta, patch)
    scheduleMeta()
    return meta
  }

  async function flush() {
    await writing
    await flushNow()
    await writing
  }

  return {
    dir,
    records,
    errors,
    load,
    append,
    flush,
    sessionMeta,
    updateSessionMeta,
    setMetaFields,
    get meta() {
      return meta
    },
    stats() {
      return {
        records: records.length,
        sessions: Object.keys(meta.sessions).length,
        cap,
        dir,
        generatedAt: now(),
      }
    },
  }
}
