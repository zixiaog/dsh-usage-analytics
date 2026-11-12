/**
 * dsh-usage-analytics · 发布前自检
 *
 * 校验 package.json 的 files/exports、patch 行、locale meta、icon 与全部 JS 语法。
 * 用法：node scripts/check.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function expand(entry) {
  if (!entry.includes('*')) return [entry]
  const [dirPart, filePart] = entry.split(/\/(?=[^/]*$)/)
  const dir = path.join(root, dirPart)
  if (!fs.existsSync(dir)) return []
  const pattern = new RegExp(`^${filePart.replaceAll('.', '\\.').replaceAll('*', '.*')}$`)
  return fs
    .readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => `${dirPart}/${name}`)
}

// ---- 1. package.json ----
const pkgFile = path.join(root, 'package.json')
let pkg
try {
  pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
} catch (error) {
  console.error(`✗ package.json 无法解析：${String(error)}`)
  process.exit(1)
}
if (!/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name ?? '')) problems.push(`package name 不合法：${pkg.name}`)
if (!/^\d+\.\d+\.\d+/.test(pkg.version ?? '')) problems.push(`version 不合法：${pkg.version}`)
if (pkg.type !== 'module') problems.push('package.json 缺少 "type": "module"')
if (!pkg.dsh?.bundle?.patch) problems.push('缺少 dsh.bundle.patch')
if (!pkg.dsh?.client?.platform) problems.push('缺少 dsh.client.platform（本插件有浏览器半侧）')
if (pkg.dsh?.client && pkg.dsh.client.platform !== 'web') problems.push('dsh.client.platform 必须是 web')

// files 必须覆盖运行时文件，且列出的文件真实存在
const declared = []
for (const entry of pkg.files ?? []) {
  const matches = expand(entry)
  if (matches.length === 0) problems.push(`files 条目没有匹配到文件：${entry}`)
  declared.push(...matches)
}
const required = ['index.js', 'client.js', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json', 'icon.svg', 'README.md', 'LICENSE']
for (const file of required) {
  if (!declared.includes(file)) problems.push(`files 未包含必需文件：${file}`)
}

// exports 指向真实文件
for (const [key, value] of Object.entries(pkg.exports ?? {})) {
  const target = typeof value === 'string' ? value : value?.default ?? value?.import
  if (!target) {
    problems.push(`exports["${key}"] 没有可用目标`)
    continue
  }
  if (target.includes('*')) continue
  if (!fs.existsSync(path.join(root, target))) problems.push(`exports["${key}"] 指向不存在的文件：${target}`)
}

// ---- 2. patch ----
const patchFile = path.join(root, pkg.dsh?.bundle?.patch ?? 'cordis.patch.yml')
if (!fs.existsSync(patchFile)) {
  problems.push('bundle patch 文件不存在')
} else {
  const patch = fs.readFileSync(patchFile, 'utf8')
  if (!patch.includes(`name: '${pkg.name}'`)) problems.push(`patch 未插入本包行：${pkg.name}`)
  if (!/id:\s*usage-analytics/.test(patch)) problems.push('patch 缺少 id: usage-analytics 行')
}

// ---- 3. locale meta ----
for (const locale of ['zh', 'en']) {
  const file = path.join(root, 'locale', `${locale}.json`)
  if (!fs.existsSync(file)) continue
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!json?.meta?.title) problems.push(`locale/${locale}.json 缺少 meta.title`)
    if (!json?.meta?.description) problems.push(`locale/${locale}.json 缺少 meta.description`)
  } catch (error) {
    problems.push(`locale/${locale}.json 解析失败：${String(error)}`)
  }
}

// ---- 4. icon ----
const iconFile = path.join(root, 'icon.svg')
if (fs.existsSync(iconFile)) {
  const bytes = fs.statSync(iconFile).size
  if (bytes > 256 * 1024) problems.push(`icon.svg 超过 256 KiB：${bytes}`)
  const head = fs.readFileSync(iconFile, 'utf8').trimStart()
  if (!head.startsWith('<svg')) problems.push('icon.svg 不是有效的 SVG 文本')
} else {
  problems.push('icon.svg 不存在')
}

// ---- 5. JS 语法 ----
const jsFiles = ['index.js', 'client.js', ...expand('lib/*.js'), ...expand('test/*.mjs'), ...expand('scripts/*.mjs')]
for (const file of jsFiles) {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) continue
  const result = spawnSync(process.execPath, ['--check', full], { stdio: 'inherit' })
  if (result.status !== 0) problems.push(`语法检查失败：${file}`)
  else notes.push(`✓ ${file}`)
}

// ---- 6. client.js 入口格式 ----
const clientFile = path.join(root, 'client.js')
if (fs.existsSync(clientFile)) {
  const source = fs.readFileSync(clientFile, 'utf8')
  if (!source.includes('__ModuleLoader__.load')) problems.push('client.js 缺少 window.__ModuleLoader__.load 入口')
  if (!source.includes(`id: '${pkg.name}'`) && !source.includes(`id: "${pkg.name}"`)) {
    problems.push(`client.js 的模块 id 必须等于包名 ${pkg.name}`)
  }
  if (/\bimport\s.+from\b/.test(source) || /\bexport\s+(default|const|function)\b/.test(source)) {
    problems.push('client.js 必须是普通脚本，不能含 import/export')
  }
  if (/require\(['"](?!react['"])/.test(source)) {
    problems.push('client.js 只允许 require(\'react\')')
  }
}

// ---- 输出 ----
for (const note of notes) console.log(note)
if (problems.length > 0) {
  console.error('\n自检未通过：')
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
console.log('\n✅ 自检通过')
