/**
 * dsh-usage-analytics · 通用工具
 *
 * 只放和 DSH 无关的纯函数：路径、时间、数字、JSON 读写。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

/** 解析 DSH_HOME：优先环境变量，其次 ~/.dsh。 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim())
  return path.join(os.homedir(), '.dsh')
}

/** 历史落盘目录：默认 <DSH_HOME>/storages；相对路径按 DSH_HOME 解析。 */
export function resolveStorageDir(override) {
  if (override && typeof override === 'string' && override.trim()) {
    const raw = override.trim()
    return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(resolveDshHome(), raw)
  }
  return path.join(resolveDshHome(), 'storages')
}

export function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function toNonNegativeInt(value) {
  const n = toFiniteNumber(value, 0)
  return n > 0 ? Math.round(n) : 0
}

/** Windows / POSIX 都能取最后一段目录名。 */
export function basenameOf(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  const parts = value.split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** 会话展示标签：优先 cwd 目录名，其次 id 前 8 位。 */
export function sessionLabel(header, sid) {
  const base = basenameOf(header?.cwd)
  if (base) return base
  const id = String(sid ?? header?.id ?? '')
  return id.replace(/^session-/, '').slice(0, 8) || 'session'
}

export async function readJsonFile(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf8')
    if (!text.trim()) return fallback
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** 原子写：先写临时文件再 rename，避免进程中断留下半个 JSON。 */
export async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fs.rename(tmp, file)
}

export async function appendLines(file, lines) {
  if (lines.length === 0) return
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, lines.map((line) => `${line}\n`).join(''), 'utf8')
}

export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
