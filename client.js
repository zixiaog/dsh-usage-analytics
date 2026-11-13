/**
 * dsh-usage-analytics · Client 半侧（v0.1）
 *
 * 浏览器端唯一格式：window.__ModuleLoader__.load({ id, factory })；React 从宿主模块表
 * require('react')，不引其它包，不用 JSX。
 *
 * 组件清单：
 *   makeTranslator / format 工具     文案与数字格式化
 *   LineChart / HourlyChart          成本趋势折线与按日 24 小时柱状
 *   TokenDonut / ModelBars            Token 环形结构与模型分布
 *   PeakValley                       峰谷对比与谷时节省
 *   RecentRecords                    最近轮次/步骤（默认折叠）
 *   StatCards / Dashboard            六张统计卡与整个面板
 *   Dock                             conversation.composer.dock 坞
 *   Overlay                          shell.overlay 全屏浮层
 *   apply                            locale/样式/slot 注册
 *
 * 视觉约定：颜色只用宿主主题 token（--dsw-alias-* / --dsw-static-*）；样式集中在注入的
 * <style id="ua-styles">，由 ctx.effect 安装/清理；数据只来自同源 /usage-dashboard/api/*。
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-analytics',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'dsh-usage-analytics'
    const API = '/usage-dashboard/api'
    const STYLE_ID = 'ua-styles'

    // -------------------------------------------------------------------
    // 主题 token 表（值来自宿主；fallback 仅用于 token 缺失时兜底）
    // -------------------------------------------------------------------
    const T = {
      text: 'var(--dsw-alias-label-primary, #1a1a1a)',
      text2: 'var(--dsw-alias-label-secondary, #5f5f66)',
      text3: 'var(--dsw-alias-label-tertiary, #8a8a93)',
      bg: 'var(--dsw-alias-bg-base, #ffffff)',
      layer: 'var(--dsw-alias-bg-layer-1, #f7f7f8)',
      layer2: 'var(--dsw-alias-bg-layer-2, #efeff1)',
      border: 'var(--dsw-alias-border-l1, #e6e6ea)',
      border2: 'var(--dsw-alias-border-l2, #d6d6dc)',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      success: 'var(--dsw-alias-state-success-primary, #16a34a)',
      warn: 'var(--dsw-alias-state-warn-primary, #d97706)',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.045))',
      mask: 'var(--dsw-alias-bg-mask-drop, rgba(0,0,0,0.5))',
      successSoft: 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 11%, transparent)',
      successLine: 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 22%, transparent)',
      warnSoft: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 12%, transparent)',
    }

    // 图表语义色：输入 / 命中 / 缓存写入 / 输出 + 模型条调色板
    const C = {
      input: 'var(--dsw-static-blue-500, #3b82f6)',
      cacheRead: 'var(--dsw-static-green-500, #22c55e)',
      cacheWrite: 'var(--dsw-static-violet-600, #7c3aed)',
      output: 'var(--dsw-static-amber-500, #f59e0b)',
      line: 'var(--dsw-static-deepseek-500, #4d6bfe)',
      palette: [
        'var(--dsw-static-deepseek-500, #4d6bfe)', 'var(--dsw-static-violet-600, #7c3aed)',
        'var(--dsw-static-amber-500, #f59e0b)', 'var(--dsw-static-green-500, #22c55e)',
        'var(--dsw-static-blue-400, #60a5fa)', 'var(--dsw-static-red-500, #ef4444)',
        'var(--dsw-static-deepseek-300, #94a8ff)', 'var(--dsw-static-neutral-400, #a1a1aa)',
      ],
    }

    // -------------------------------------------------------------------
    // 文案（中文基准 + 英文对照）
    // -------------------------------------------------------------------
    const ZH = {
      'dock.title': '用量分析', 'dock.peak': '峰时', 'dock.valley': '谷时', 'dock.next': '距{label}',
      'dock.session': '本会话', 'dock.turn': '本轮', 'dock.balance': '账户余额', 'dock.expand': '展开',
      'dock.open': '打开用量分析', 'dock.none': '—',
      'panel.title': '用量分析', 'panel.updated': '更新于 {time}', 'panel.aria': '用量分析面板',
      'range.label': '时间范围', 'range.today': '今天', 'range.7d': '7天', 'range.30d': '30天',
      'range.90d': '90天', 'range.all': '全部',
      'session.label': '会话范围', 'session.all': '全部会话', 'session.current': '本会话',
      'session.unavailable': '当前会话未知，无法只看本会话',
      'model.label': '模型筛选', 'model.all': '全部模型',
      'action.refresh': '刷新', 'action.close': '关闭',
      'day.prev': '前一天', 'day.next': '后一天', 'day.back': '回到今天范围',
      'stat.cost': '成本', 'stat.cost.sub': '峰 {peak} · 谷 {valley}',
      'stat.tokens': 'Tokens', 'stat.tokens.sub': '输入 {input} · 输出 {output}',
      'stat.turns': '轮次', 'stat.turns.sub': '峰 {peak} 步 · 谷 {valley} 步',
      'stat.cache': '缓存命中率', 'stat.cache.sub': '命中 {value}',
      'stat.saved': '谷时节省', 'stat.saved.sub': '谷时 {steps} 步',
      'stat.avg': '单步均值', 'stat.avg.sub': '平均 {tokens} tok/步',
      'chart.trend': '成本趋势', 'chart.trend.hint': '点击某天查看当天明细',
      'chart.hourly': '24 小时成本分布', 'chart.hourly.hint': '北京时间',
      'chart.tokens': 'Token 结构', 'chart.mix.all': '全部', 'chart.mix.model': '按模型',
      'chart.models': '模型分布', 'chart.models.hint': '按成本降序', 'chart.pv': '峰谷对比',
      'mix.input': '输入-未命中', 'mix.cacheRead': '输入-命中', 'mix.cacheWrite': '缓存写入', 'mix.output': '输出',
      'pv.peak': '波峰', 'pv.valley': '波谷', 'pv.summary': '{cost} · {steps} 步',
      'pv.saved': '谷时节省 {cost} ≈ {percent}',
      'pv.fees': '工具费 {cost}（搜索 {search} 次 · 抓取 {fetch} 次）',
      'pv.fees.hint': '搜索 / 抓取按次计费（¥5 / 1000 次），不分峰谷；来自会话里的 web_search / web_fetch 调用',
      'recent.title': '最近记录', 'recent.meta': '{turns} 轮 · {steps} 步',
      'recent.expand': '展开全部', 'recent.collapse': '收起',
      'recent.turn': '第{turn}轮', 'recent.step': '第{turn}轮 第{step}步', 'recent.more': '还有 {n} 步…',
      'recent.mix': '输入 {input} · 命中 {cacheRead} · 输出 {output}',
      'tag.peak': '峰时', 'tag.valley': '谷时',
      'empty.title': '还没有用量记录，先聊几句吧', 'empty.hint': '对话产生用量后，这里会自动出现统计',
      'empty.chart': '当前筛选条件下没有数据', 'empty.recent': '暂时没有可展示的轮次',
      'error.load': '数据读取失败，显示上次结果', 'error.first': '数据读取失败，请稍后点刷新重试',
      'loading': '加载中…',
    }

    const EN = {
      'dock.title': 'Usage analytics', 'dock.peak': 'Peak', 'dock.valley': 'Off-peak', 'dock.next': '{label} in',
      'dock.session': 'Session', 'dock.turn': 'Turn', 'dock.balance': 'Balance', 'dock.expand': 'Expand',
      'dock.open': 'Open usage analytics', 'dock.none': '—',
      'panel.title': 'Usage analytics', 'panel.updated': 'Updated {time}', 'panel.aria': 'Usage analytics panel',
      'range.label': 'Time range', 'range.today': 'Today', 'range.7d': '7d', 'range.30d': '30d',
      'range.90d': '90d', 'range.all': 'All',
      'session.label': 'Session scope', 'session.all': 'All sessions', 'session.current': 'This session',
      'session.unavailable': 'Current session unknown',
      'model.label': 'Model', 'model.all': 'All models',
      'action.refresh': 'Refresh', 'action.close': 'Close',
      'day.prev': 'Previous day', 'day.next': 'Next day', 'day.back': 'Back to range',
      'stat.cost': 'Cost', 'stat.cost.sub': 'Peak {peak} · Off-peak {valley}',
      'stat.tokens': 'Tokens', 'stat.tokens.sub': 'In {input} · Out {output}',
      'stat.turns': 'Turns', 'stat.turns.sub': 'Peak {peak} steps · Off-peak {valley} steps',
      'stat.cache': 'Cache hit rate', 'stat.cache.sub': 'Hit {value}',
      'stat.saved': 'Off-peak savings', 'stat.saved.sub': 'Off-peak {steps} steps',
      'stat.avg': 'Avg per step', 'stat.avg.sub': '{tokens} tok/step',
      'chart.trend': 'Cost trend', 'chart.trend.hint': 'Click a day for details',
      'chart.hourly': 'Hourly cost', 'chart.hourly.hint': 'Beijing time',
      'chart.tokens': 'Token mix', 'chart.mix.all': 'All', 'chart.mix.model': 'By model',
      'chart.models': 'Model mix', 'chart.models.hint': 'By cost, descending', 'chart.pv': 'Peak vs off-peak',
      'mix.input': 'Input (uncached)', 'mix.cacheRead': 'Input (cached)', 'mix.cacheWrite': 'Cache write', 'mix.output': 'Output',
      'pv.peak': 'Peak', 'pv.valley': 'Off-peak', 'pv.summary': '{cost} · {steps} steps',
      'pv.saved': 'Off-peak saved {cost} ≈ {percent}',
      'pv.fees': 'Tool fees {cost} ({search} searches · {fetch} fetches)',
      'pv.fees.hint': 'Search / fetch are billed per request (¥5 per 1,000), no peak/off-peak split; counted from web_search / web_fetch tool calls',
      'recent.title': 'Recent', 'recent.meta': '{turns} turns · {steps} steps',
      'recent.expand': 'Expand all', 'recent.collapse': 'Collapse',
      'recent.turn': 'Turn {turn}', 'recent.step': 'Turn {turn} step {step}', 'recent.more': '{n} more steps…',
      'recent.mix': 'In {input} · Cached {cacheRead} · Out {output}',
      'tag.peak': 'Peak', 'tag.valley': 'Off-peak',
      'empty.title': 'No usage yet — say something first', 'empty.hint': 'Statistics appear once the conversation produces usage',
      'empty.chart': 'No data for the current filters', 'empty.recent': 'No turns to show yet',
      'error.load': 'Failed to load, showing the last result', 'error.first': 'Failed to load, try refreshing later',
      'loading': 'Loading…',
    }

    function makeTranslator(dict) {
      return function translate(key, params) {
        const template = dict[key] ?? ZH[key] ?? key
        if (!params) return template
        return String(template).replace(/\{(\w+)\}/g, (_, name) => (params[name] == null ? '' : String(params[name])))
      }
    }

    // -------------------------------------------------------------------
    // 数字 / 时间格式化
    // -------------------------------------------------------------------
    function num(value) {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? n : 0
    }
    function pad2(value) { return String(value).padStart(2, '0') }
    function trimZeros(text) { return text.indexOf('.') < 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '') }
    function fmtInt(value) {
      const n = Math.round(num(value))
      return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }
    /** 千分位 / k / M / B：<1k 原样，k 最多 1 位，M/B 固定 2 位并去掉末尾 0。 */
    function fmtCompact(value) {
      const n = num(value)
      const abs = Math.abs(n)
      const sign = n < 0 ? '-' : ''
      if (abs < 1000) return sign + (Number.isInteger(abs) ? String(abs) : trimZeros(abs.toFixed(1)))
      if (abs < 1e6) return sign + trimZeros((abs / 1e3).toFixed(abs / 1e3 >= 100 ? 0 : 1)) + 'k'
      if (abs < 1e9) return sign + trimZeros((abs / 1e6).toFixed(2)) + 'M'
      return sign + trimZeros((abs / 1e9).toFixed(2)) + 'B'
    }
    /** 汇总成本：默认 2 位，小于 0.01 时 4 位（契约第 4 节）。 */
    function fmtCost(value) {
      const n = num(value)
      if (n === 0) return '¥0.00'
      const abs = Math.abs(n)
      return (n < 0 ? '-¥' : '¥') + abs.toFixed(abs < 0.01 ? 4 : 2)
    }
    /** 单步级成本：最多 4 位，去掉末尾 0 但至少保留 2 位（¥0.045 / ¥0.0025 / ¥0.08）。 */
    function fmtCostFine(value) {
      const n = num(value)
      if (n === 0) return '¥0.00'
      const abs = Math.abs(n)
      let text = trimZeros(abs.toFixed(4))
      const dot = text.indexOf('.')
      if (dot < 0) text += '.00'
      else if (text.length - dot - 1 < 2) text = text.padEnd(dot + 3, '0')
      return (n < 0 ? '-¥' : '¥') + text
    }
    function fmtPercent(value) { return trimZeros((num(value) * 100).toFixed(1)) + '%' }
    function fmtMoneyAxis(value) {
      const n = num(value)
      if (n === 0) return '¥0'
      if (n >= 1000) return '¥' + fmtCompact(n)
      if (n >= 10) return '¥' + trimZeros(n.toFixed(0))
      if (n >= 1) return '¥' + trimZeros(n.toFixed(1))
      return '¥' + trimZeros(n.toFixed(2))
    }
    function fmtTime(timestamp) {
      const ts = num(timestamp)
      if (!ts) return '—'
      const date = new Date(ts)
      return Number.isNaN(date.getTime()) ? '—' : pad2(date.getHours()) + ':' + pad2(date.getMinutes())
    }
    /** 余额：最多 2 位（小于 1 时 4 位），去掉尾零；非法值原样返回。 */
    function fmtBalance(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return String(value === null || value === undefined || value === '' ? '—' : value)
      const digits = Math.abs(n) >= 1 ? 2 : 4
      return trimZeros(n.toFixed(digits))
    }
    /** 'YYYY-MM-DD' 或时间戳 → 'MM-DD'。 */
    function fmtDay(value) {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5)
      const ts = num(value)
      if (!ts) return '—'
      const date = new Date(ts)
      return Number.isNaN(date.getTime()) ? '—' : pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    }
    function dayKeyOf(timestamp) {
      const date = new Date(num(timestamp) || Date.now())
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    }
    function shiftDayKey(key, delta) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''))
      if (!match) return key
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      date.setUTCDate(date.getUTCDate() + delta)
      return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate())
    }
    /** 倒计时：3h27m / 27m / 18s。 */
    function fmtCountdown(ms) {
      const total = Math.max(0, Math.floor(num(ms) / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      if (hours > 0) return hours + 'h' + pad2(minutes) + 'm'
      if (minutes > 0) return minutes + 'm'
      return (total % 60) + 's'
    }
    function clamp01(value) {
      const n = num(value)
      return n < 0 ? 0 : n > 1 ? 1 : n
    }
    function shortModel(model) {
      const name = String(model ?? '')
      return name ? name.replace(/^deepseek-/, '') || name : '?'
    }
    async function fetchJson(path, options) {
      const response = await fetch(path, Object.assign({ cache: 'no-store' }, options || {}))
      if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : 0))
      return response.json()
    }

    // -------------------------------------------------------------------
    // 模块级面板开关 store（Dock 与 Overlay 共享，不 portal）
    // -------------------------------------------------------------------
    let panelOpen = false
    const openSubscribers = new Set()

    function setPanelOpen(next) {
      const value = Boolean(next)
      if (value === panelOpen) return
      panelOpen = value
      for (const subscriber of Array.from(openSubscribers)) {
        try { subscriber(panelOpen) } catch { /* 单个订阅者异常不影响其它订阅者 */ }
      }
    }

    function usePanelOpen() {
      const [open, setLocalOpen] = useState(panelOpen)
      useEffect(() => {
        const subscriber = (value) => setLocalOpen(value)
        openSubscribers.add(subscriber)
        setLocalOpen(panelOpen)
        return () => { openSubscribers.delete(subscriber) }
      }, [])
      return [open, setPanelOpen]
    }

    // Dock 是唯一知道当前会话 id 的地方；Overlay 靠它给 session=current 补 sid。
    let activeSessionId

    // -------------------------------------------------------------------
    // 样式（唯一 <style id="ua-styles">，由 apply 注入）
    // -------------------------------------------------------------------
    const CSS = `
.ua-dock{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:22px;padding:2px;font-size:12px;line-height:1.35;color:${T.text2};cursor:pointer;user-select:none;border-radius:8px;transition:background .12s,color .12s;min-width:0}
.ua-dock:hover{background:${T.hover};color:${T.text}}
.ua-dock:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.ua-dock-group{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;min-width:0}
.ua-dock-time,.ua-dock-count{color:${T.text3};font-variant-numeric:tabular-nums}
.ua-dock b{color:${T.text};font-weight:650;font-variant-numeric:tabular-nums}
.ua-dot{width:6px;height:6px;border-radius:50%;flex:none;display:inline-block;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 16%,transparent)}
.ua-dock-track{width:56px;height:3px;border-radius:999px;background:${T.layer2};overflow:hidden;flex:none}
.ua-dock-track>span{display:block;height:100%;border-radius:999px;transition:width .3s ease}
.ua-dock-divider{width:1px;height:11px;background:${T.border};flex:none}
.ua-dock-mid{color:${T.text3};flex:none}
.ua-dock-expand{margin-left:auto;display:inline-flex;align-items:center;gap:3px;color:${T.text3};font-size:11.5px;flex:none;padding:1px 2px 1px 4px;border:0;background:transparent;font-family:inherit;cursor:pointer}
.ua-dock:hover .ua-dock-expand{color:${T.text}}
.ua-dock-expand:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.ua-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:${T.mask};animation:ua-fade .14s ease;padding:12px;box-sizing:border-box}
.ua-panel{width:min(1120px,94vw);height:min(86vh,780px);display:flex;flex-direction:column;min-height:0;background:${T.bg};color:${T.text};border:1px solid ${T.border};border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.28),0 2px 10px rgba(0,0,0,.12);overflow:hidden;animation:ua-pop .16s ease;font-family:inherit;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
.ua-panel-inner{display:flex;flex-direction:column;height:100%;min-height:0}
.ua-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid ${T.border};flex:none}
.ua-titlewrap{display:flex;align-items:baseline;gap:8px;min-width:0}
.ua-title{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em;color:${T.text};white-space:nowrap}
.ua-head-meta{font-size:10.5px;color:${T.text3};white-space:nowrap;font-variant-numeric:tabular-nums}
.ua-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.ua-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid ${T.border};border-radius:9px;background:${T.layer};flex:none}
.ua-seg button{appearance:none;border:0;background:transparent;color:${T.text2};font:inherit;font-size:11.5px;line-height:1;padding:5px 9px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s,box-shadow .12s}
.ua-seg button:hover:not(:disabled){color:${T.text};background:${T.hover}}
.ua-seg button[aria-pressed="true"]{background:${T.bg};color:${T.text};font-weight:600;box-shadow:0 0 0 1px ${T.border}}
.ua-seg button:disabled{opacity:.45;cursor:not-allowed}
.ua-seg.sm button{font-size:10.5px;padding:3px 7px}
.ua-select{height:27px;border:1px solid ${T.border};border-radius:8px;background:${T.bg};color:${T.text};font:inherit;font-size:11.5px;padding:0 6px;max-width:170px;cursor:pointer;flex:none}
.ua-select:focus-visible,.ua-seg button:focus-visible,.ua-icon-btn:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.ua-icon-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;color:${T.text2};border-radius:8px;cursor:pointer;padding:0;font:inherit;flex:none}
.ua-icon-btn:hover:not(:disabled){background:${T.hover};color:${T.text}}
.ua-icon-btn:disabled{opacity:.4;cursor:not-allowed}
.ua-glyph{font-size:15px;line-height:1}
.ua-spin{animation:ua-spin .9s linear infinite}
.ua-daybar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 16px;border-bottom:1px solid ${T.border};background:${T.layer};font-size:12px;color:${T.text2};flex:none}
.ua-daybar b{color:${T.text};font-weight:600;font-variant-numeric:tabular-nums;padding:0 2px}
.ua-daybar-link{appearance:none;border:0;background:transparent;color:${T.brand};font:inherit;font-size:11.5px;cursor:pointer;padding:3px 6px;border-radius:6px}
.ua-daybar-link:hover{background:${T.hover}}
.ua-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:14px 16px 20px;display:flex;flex-direction:column;gap:12px;background:${T.bg}}
.ua-notice{border:1px solid ${T.border};background:${T.layer};color:${T.text2};border-radius:9px;padding:6px 10px;font-size:11px}
.ua-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
@media (max-width:1000px){.ua-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:620px){.ua-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ua-stat{border:1px solid ${T.border};border-radius:12px;background:${T.layer};padding:10px 12px;min-width:0;box-sizing:border-box}
.ua-stat-label{font-size:11px;color:${T.text3};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ua-stat-value{font-size:19px;font-weight:650;letter-spacing:-.02em;margin:2px 0 1px;color:${T.text};font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ua-stat-sub{font-size:10.5px;color:${T.text3};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ua-grid2{display:grid;grid-template-columns:minmax(0,62fr) minmax(0,38fr);gap:12px}
@media (max-width:900px){.ua-grid2{grid-template-columns:1fr}}
.ua-card{border:1px solid ${T.border};border-radius:12px;background:${T.layer};padding:12px 14px;min-width:0;box-sizing:border-box}
.ua-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-height:20px;flex-wrap:wrap}
.ua-card-title{font-size:12.5px;font-weight:600;color:${T.text};white-space:nowrap}
.ua-card-hint{font-size:10.5px;color:${T.text3};margin-left:auto;white-space:nowrap}
.ua-chart-wrap{position:relative;min-height:80px}
.ua-svg{display:block;width:100%;height:auto;overflow:visible}
.ua-tip{position:absolute;pointer-events:none;transform:translate(-50%,-118%);background:${T.bg};border:1px solid ${T.border2};border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);padding:5px 8px;font-size:11px;color:${T.text};white-space:nowrap;z-index:2;font-variant-numeric:tabular-nums}
.ua-tip-sub{color:${T.text3};font-size:10.5px}
.ua-donut-wrap{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ua-donut{position:relative;flex:none}
.ua-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center}
.ua-donut-center b{font-size:17px;font-weight:650;letter-spacing:-.01em;color:${T.text}}
.ua-donut-center span{font-size:10px;color:${T.text3}}
.ua-legend{flex:1;min-width:168px;display:flex;flex-direction:column;gap:1px}
.ua-legend-row{display:flex;align-items:center;gap:7px;font-size:11px;padding:3px 0;min-width:0}
.ua-legend-dot{width:8px;height:8px;border-radius:3px;flex:none}
.ua-legend-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${T.text2}}
.ua-legend-val{color:${T.text2};font-variant-numeric:tabular-nums;flex:none}
.ua-legend-pct{width:42px;text-align:right;color:${T.text3};font-size:10.5px;flex:none;font-variant-numeric:tabular-nums}
.ua-mix{display:flex;flex-direction:column;gap:8px}
.ua-mix-row{display:flex;flex-direction:column;gap:3px}
.ua-mix-top{display:flex;gap:8px;font-size:11px;align-items:baseline;min-width:0}
.ua-mix-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${T.text2}}
.ua-mix-cost{color:${T.text3};font-variant-numeric:tabular-nums;flex:none}
.ua-mix-bar{display:flex;height:9px;border-radius:999px;overflow:hidden;background:${T.layer2}}
.ua-mix-bar span{height:100%;display:block}
.ua-bars{display:flex;flex-direction:column;gap:9px}
.ua-bar-row{display:flex;flex-direction:column;gap:4px}
.ua-bar-top{display:flex;align-items:baseline;gap:8px;font-size:11.5px;min-width:0}
.ua-bar-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${T.text}}
.ua-bar-num{color:${T.text2};font-variant-numeric:tabular-nums;flex:none;font-size:11px}
.ua-bar-track{height:6px;border-radius:999px;background:${T.layer2};overflow:hidden}
.ua-bar-track span{display:block;height:100%;border-radius:999px;transition:width .35s ease}
.ua-bar-empty{font-size:11.5px;color:${T.text3};padding:10px 0}
.ua-pv{display:flex;flex-direction:column;gap:12px;padding-top:2px}
.ua-pv-row{display:flex;align-items:center;gap:8px;min-width:0}
.ua-pv-name{color:${T.text};font-size:11.5px;flex:none;width:38px}
.ua-pv-track{flex:1;height:8px;border-radius:999px;background:${T.layer2};overflow:hidden;min-width:40px}
.ua-pv-track span{display:block;height:100%;border-radius:999px;transition:width .35s ease}
.ua-pv-num{color:${T.text2};font-variant-numeric:tabular-nums;flex:none;font-size:11px;margin-left:auto}
.ua-saved{margin-top:12px;border-radius:9px;padding:7px 10px;font-size:11.5px;color:${T.success};background:${T.successSoft};border:1px solid ${T.successLine};display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.ua-fee{margin-top:6px;border-radius:9px;padding:6px 10px;font-size:11px;color:${T.text2};background:${T.layer2};border:1px solid ${T.border};display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.ua-recent-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.ua-recent-list{max-height:180px;overflow-y:auto;overscroll-behavior:contain;border-top:1px solid ${T.border};padding-top:2px;margin:0 -2px}
.ua-group{display:flex;align-items:center;gap:8px;font-size:11.5px;padding:5px 4px;border-radius:6px;cursor:pointer;color:${T.text};min-width:0}
.ua-group:hover{background:${T.hover}}
.ua-group:focus-visible{outline:2px solid ${T.brand};outline-offset:-2px}
.ua-chev{transition:transform .15s ease;color:${T.text3};flex:none;display:inline-flex}
.ua-group.open .ua-chev{transform:rotate(90deg)}
.ua-badge{font-size:9.5px;padding:1px 5px;border-radius:5px;background:${T.layer2};color:${T.text3};max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
.ua-group-title{flex:none;font-weight:550;font-variant-numeric:tabular-nums}
.ua-model{color:${T.text2};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:11px}
.ua-money{font-variant-numeric:tabular-nums;flex:none;color:${T.text}}
.ua-tag{font-size:9.5px;border-radius:999px;padding:1px 6px;flex:none;white-space:nowrap}
.ua-tag.peak{color:${T.warn};background:${T.warnSoft}}
.ua-tag.valley{color:${T.success};background:${T.successSoft}}
.ua-step{display:flex;align-items:center;gap:8px;font-size:11px;padding:4px 4px 4px 26px;color:${T.text2};min-width:0}
.ua-step-title{flex:none;color:${T.text3};font-variant-numeric:tabular-nums}
.ua-step-mix{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:${T.text3};font-variant-numeric:tabular-nums}
.ua-step-money{font-variant-numeric:tabular-nums;flex:none;font-size:10.5px}
.ua-more{font-size:10.5px;color:${T.text3};padding:3px 4px 6px 26px}
.ua-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center;color:${T.text3};font-size:12px;padding:44px 16px;min-height:180px}
.ua-empty b{font-size:13px;color:${T.text2};font-weight:550}
.ua-loading{display:flex;align-items:center;justify-content:center;color:${T.text3};font-size:12px;padding:60px 16px;min-height:200px}
@keyframes ua-fade{from{opacity:0}to{opacity:1}}
@keyframes ua-pop{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}
@keyframes ua-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ua-mask,.ua-panel{animation:none}.ua-spin{animation-duration:1.6s}}
`

    // -------------------------------------------------------------------
    // 小图标与分段筛选
    // -------------------------------------------------------------------
    const ICON_PATHS = { down: 'M4 6l4 4 4-4', right: 'M6 4l4 4-4 4', left: 'M10 4L6 8l4 4', close: 'M4.5 4.5l7 7M11.5 4.5l-7 7', check: 'M3.5 8.5l3 3 6-6' }
    function icon(name, size) {
      return h('svg', {
        width: size ?? 14, height: size ?? 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: ICON_PATHS[name] ?? ICON_PATHS.right }))
    }
    function Segmented(props) {
      return h('div', { className: 'ua-seg' + (props.className ? ' ' + props.className : ''), role: 'group', 'aria-label': props.label },
        ...props.options.map((option) => h('button', {
          key: option.value, type: 'button', disabled: option.disabled === true, title: option.title,
          'aria-pressed': props.value === option.value ? 'true' : 'false',
          onClick: () => props.onChange(option.value),
        }, option.label)))
    }
    function tag(peak, t) {
      return h('span', { className: 'ua-tag ' + (peak ? 'peak' : 'valley') }, peak ? t('tag.peak') : t('tag.valley'))
    }
    function emptyBlock(t, key) {
      return h('div', { className: 'ua-card ua-empty', key }, h('b', null, t('empty.title')), h('span', null, t('empty.hint')))
    }
    function card(t, title, hint, children) {
      return h('div', { className: 'ua-card' },
        h('div', { className: 'ua-card-head' },
          h('span', { className: 'ua-card-title' }, title),
          hint ? h('span', { className: 'ua-card-hint' }, hint) : null),
        children)
    }

    // -------------------------------------------------------------------
    // 统计卡（6 个等宽卡片）
    // -------------------------------------------------------------------
    function StatCards(props) {
      const t = props.t
      const overview = props.overview || {}
      const cards = [
        { key: 'cost', label: t('stat.cost'), value: fmtCost(overview.cost),
          sub: t('stat.cost.sub', { peak: fmtCost(overview.peakCost), valley: fmtCost(overview.valleyCost) }) },
        { key: 'tokens', label: t('stat.tokens'), value: fmtCompact(overview.tokens),
          sub: t('stat.tokens.sub', { input: fmtCompact(overview.input), output: fmtCompact(overview.output) }) },
        { key: 'turns', label: t('stat.turns'), value: fmtInt(overview.turns),
          sub: t('stat.turns.sub', { peak: fmtInt(overview.peakSteps), valley: fmtInt(overview.valleySteps) }) },
        { key: 'cache', label: t('stat.cache'), value: fmtPercent(overview.cacheHitRate),
          sub: t('stat.cache.sub', { value: fmtCompact(overview.cacheRead) }) },
        { key: 'saved', label: t('stat.saved'), value: fmtCost(overview.savedValley),
          sub: t('stat.saved.sub', { steps: fmtInt(overview.valleySteps) }) },
        { key: 'avg', label: t('stat.avg'), value: fmtCostFine(overview.avgCostPerStep),
          sub: t('stat.avg.sub', { tokens: fmtCompact(overview.avgTokensPerStep) }) },
      ]
      return h('div', { className: 'ua-cards' }, ...cards.map((entry) => h('div', { className: 'ua-stat', key: entry.key },
        h('div', { className: 'ua-stat-label' }, entry.label),
        h('div', { className: 'ua-stat-value' }, entry.value),
        h('div', { className: 'ua-stat-sub' }, entry.sub))))
    }

    // -------------------------------------------------------------------
    // 成本趋势折线（悬浮 tooltip + 点击某天下钻）
    // -------------------------------------------------------------------
    const CHART_W = 640
    const CHART_H = 190
    const CHART_PAD = { left: 46, right: 12, top: 12, bottom: 24 }

    function niceMax(max) {
      if (!(max > 0)) return 1
      const rough = max / 4
      const magnitude = 10 ** Math.floor(Math.log10(rough))
      const normalized = rough / magnitude
      const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
      return step * magnitude * 4
    }

    function LineChart(props) {
      const t = props.t
      const days = Array.isArray(props.days) ? props.days : []
      const [hover, setHover] = useState(-1)
      if (days.length === 0) return h('div', { className: 'ua-bar-empty' }, t('empty.chart'))
      const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right
      const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
      const max = Math.max(0, ...days.map((day) => num(day.cost)))
      const top = niceMax(max)
      const xOf = (index) => (days.length <= 1 ? CHART_PAD.left + plotW / 2 : CHART_PAD.left + (index / (days.length - 1)) * plotW)
      const yOf = (value) => CHART_PAD.top + plotH - (top > 0 ? clamp01(num(value) / top) : 0) * plotH
      const points = days.map((day, index) => xOf(index) + ',' + yOf(day.cost))
      const linePath = points.map((point, index) => (index === 0 ? 'M' : 'L') + point).join(' ')
      const baseline = (CHART_PAD.top + plotH).toFixed(1)
      const areaPath = 'M' + xOf(0) + ' ' + baseline + ' ' + points.map((point) => 'L' + point).join(' ') + ' L' + xOf(days.length - 1) + ' ' + baseline + ' Z'
      const xTicks = Array.from(new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]))
      const bandOf = (index) => {
        const left = index === 0 ? CHART_PAD.left : (xOf(index - 1) + xOf(index)) / 2
        const right = index === days.length - 1 ? CHART_PAD.left + plotW : (xOf(index) + xOf(index + 1)) / 2
        return { x: left, width: Math.max(1, right - left) }
      }
      const hoverDay = hover >= 0 && hover < days.length ? days[hover] : null
      return h('div', { className: 'ua-chart-wrap' },
        h('svg', { className: 'ua-svg', viewBox: '0 0 ' + CHART_W + ' ' + CHART_H, role: 'img', 'aria-label': t('chart.trend') },
          h('defs', null, h('linearGradient', { id: 'ua-area-grad', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', stopColor: C.line, stopOpacity: 0.22 }),
            h('stop', { offset: '100%', stopColor: C.line, stopOpacity: 0 }))),
          ...[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = CHART_PAD.top + plotH * (1 - ratio)
            return h('g', { key: 'y' + ratio },
              h('line', { x1: CHART_PAD.left, y1: y, x2: CHART_PAD.left + plotW, y2: y, stroke: T.border, strokeWidth: 1 }),
              h('text', { x: CHART_PAD.left - 6, y: y + 3, textAnchor: 'end', fontSize: 9.5, fill: T.text3 }, fmtMoneyAxis(top * ratio)))
          }),
          h('path', { d: areaPath, fill: 'url(#ua-area-grad)', stroke: 'none' }),
          h('path', { d: linePath, fill: 'none', stroke: C.line, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }),
          ...xTicks.map((index) => h('text', {
            key: 'x' + index, x: xOf(index), y: CHART_H - 6, fontSize: 9.5, fill: T.text3,
            textAnchor: index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle',
          }, fmtDay(days[index].date))),
          hoverDay ? h('circle', { cx: xOf(hover), cy: yOf(hoverDay.cost), r: 4, fill: C.line, stroke: T.bg, strokeWidth: 2 }) : null,
          ...days.map((day, index) => {
            const band = bandOf(index)
            return h('rect', {
              key: 'band' + index, x: band.x, y: CHART_PAD.top, width: band.width, height: plotH,
              fill: 'transparent', style: { cursor: 'pointer' },
              onMouseEnter: () => setHover(index), onMouseLeave: () => setHover(-1),
              onClick: () => props.onSelectDay && props.onSelectDay(day.date),
            })
          })),
        hoverDay ? h('div', {
          className: 'ua-tip',
          style: { left: (xOf(hover) / CHART_W) * 100 + '%', top: (yOf(hoverDay.cost) / CHART_H) * 100 + '%' },
        },
          h('div', null, fmtDay(hoverDay.date) + ' · ' + fmtCost(hoverDay.cost)),
          h('div', { className: 'ua-tip-sub' }, fmtCompact(hoverDay.tokens) + ' tok · ' + fmtInt(hoverDay.steps) + ' steps')) : null)
    }

    // -------------------------------------------------------------------
    // 按日 24 小时柱状图（day 视图替代折线）
    // -------------------------------------------------------------------
    function HourlyChart(props) {
      const t = props.t
      const hourly = Array.isArray(props.hourly) ? props.hourly : []
      const [hover, setHover] = useState(-1)
      const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right
      const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
      const top = niceMax(Math.max(0, ...hourly.map((bucket) => num(bucket.cost))))
      const gap = 3
      const barW = Math.max(2, plotW / 24 - gap)
      const baseline = CHART_PAD.top + plotH
      const hoverBucket = hover >= 0 && hover < hourly.length ? hourly[hover] : null
      const xOfHour = (hour) => CHART_PAD.left + (hour + 0.5) * (plotW / 24)
      return h('div', { className: 'ua-chart-wrap' },
        h('svg', { className: 'ua-svg', viewBox: '0 0 ' + CHART_W + ' ' + CHART_H, role: 'img', 'aria-label': t('chart.hourly') },
          ...[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = CHART_PAD.top + plotH * (1 - ratio)
            return h('g', { key: 'hy' + ratio },
              h('line', { x1: CHART_PAD.left, y1: y, x2: CHART_PAD.left + plotW, y2: y, stroke: T.border, strokeWidth: 1 }),
              h('text', { x: CHART_PAD.left - 6, y: y + 3, textAnchor: 'end', fontSize: 9.5, fill: T.text3 }, fmtMoneyAxis(top * ratio)))
          }),
          ...hourly.map((bucket, index) => {
            const value = num(bucket.cost)
            const height = top > 0 ? clamp01(value / top) * plotH : 0
            return h('g', { key: 'hb' + index },
              h('rect', {
                x: CHART_PAD.left + index * (plotW / 24) + gap / 2, y: baseline - Math.max(height, value > 0 ? 2 : 0),
                width: barW, height: Math.max(height, value > 0 ? 2 : 0), rx: 2,
                fill: bucket.peak ? T.warn : T.success, opacity: hover === index ? 1 : 0.82,
                onMouseEnter: () => setHover(index), onMouseLeave: () => setHover(-1),
              }),
              h('rect', {
                x: CHART_PAD.left + index * (plotW / 24), y: CHART_PAD.top, width: plotW / 24, height: plotH,
                fill: 'transparent', onMouseEnter: () => setHover(index), onMouseLeave: () => setHover(-1),
              }))
          }),
          ...[0, 6, 12, 18, 23].map((hour) => h('text', {
            key: 'hx' + hour, x: xOfHour(hour), y: CHART_H - 6, fontSize: 9.5, fill: T.text3,
            textAnchor: hour === 0 ? 'start' : hour === 23 ? 'end' : 'middle',
          }, String(hour)))),
        hoverBucket ? h('div', {
          className: 'ua-tip',
          style: {
            left: (xOfHour(hover) / CHART_W) * 100 + '%',
            top: Math.max(8, ((baseline - (top > 0 ? clamp01(num(hoverBucket.cost) / top) * plotH : 0)) / CHART_H) * 100) + '%',
          },
        },
          h('div', null, pad2(hoverBucket.hour) + ':00 · ' + fmtCost(hoverBucket.cost)),
          h('div', { className: 'ua-tip-sub' }, fmtInt(hoverBucket.steps) + ' steps · ' + (hoverBucket.peak ? t('tag.peak') : t('tag.valley')))) : null)
    }

    // -------------------------------------------------------------------
    // Token 结构环形图（全部 / 按模型切换）
    // -------------------------------------------------------------------
    function TokenDonut(props) {
      const t = props.t
      const [mode, setMode] = useState('all')
      const mix = props.tokenMix || {}
      const items = [
        { key: 'input', label: t('mix.input'), value: num(mix.input), color: C.input },
        { key: 'cacheRead', label: t('mix.cacheRead'), value: num(mix.cacheRead), color: C.cacheRead },
        { key: 'cacheWrite', label: t('mix.cacheWrite'), value: num(mix.cacheWrite), color: C.cacheWrite },
        { key: 'output', label: t('mix.output'), value: num(mix.output), color: C.output },
      ]
      const total = items.reduce((sum, item) => sum + item.value, 0)
      const models = (Array.isArray(props.modelMix) ? props.modelMix : []).filter(
        (entry) => num(entry.input) + num(entry.cacheRead) + num(entry.cacheWrite) + num(entry.output) > 0)
      const showModels = mode === 'model' && models.length > 0
      const size = 148
      const thickness = 16
      const radius = (size - thickness) / 2
      const center = size / 2
      const circumference = 2 * Math.PI * radius
      let offset = 0
      const ring = items.filter((item) => item.value > 0).map((item) => {
        const length = total > 0 ? (item.value / total) * circumference : 0
        const segment = { ...item, length, dashoffset: -offset }
        offset += length
        return segment
      })
      const head = h('div', { className: 'ua-card-head' },
        h('span', { className: 'ua-card-title' }, t('chart.tokens')),
        h('span', { style: { marginLeft: 'auto', display: 'inline-flex' } }, Segmented({
          className: 'sm', value: showModels ? 'model' : 'all', label: t('chart.tokens'),
          options: [
            { value: 'all', label: t('chart.mix.all') },
            { value: 'model', label: t('chart.mix.model'), disabled: models.length === 0 },
          ],
          onChange: (value) => setMode(value),
        })))
      if (showModels) {
        const modelTotal = Math.max(1, models.reduce((sum, entry) =>
          sum + num(entry.input) + num(entry.cacheRead) + num(entry.cacheWrite) + num(entry.output), 0))
        return h('div', null, head, h('div', { className: 'ua-mix' }, ...models.slice(0, 6).map((entry, index) => {
          const parts = [
            { value: num(entry.input), color: C.input }, { value: num(entry.cacheRead), color: C.cacheRead },
            { value: num(entry.cacheWrite), color: C.cacheWrite }, { value: num(entry.output), color: C.output },
          ]
          const sum = parts.reduce((acc, part) => acc + part.value, 0)
          return h('div', { className: 'ua-mix-row', key: entry.model ?? 'model' + index },
            h('div', { className: 'ua-mix-top' },
              h('span', { className: 'ua-mix-name', title: entry.model }, shortModel(entry.model)),
              h('span', { className: 'ua-mix-cost' }, fmtCompact(sum) + ' · ' + fmtCost(entry.cost))),
            h('div', { className: 'ua-mix-bar', role: 'img', 'aria-label': shortModel(entry.model) },
              ...parts.map((part, partIndex) => h('span', {
                key: 'p' + partIndex, style: { width: (part.value / modelTotal) * 100 + '%', background: part.color },
              }))))
        })))
      }
      return h('div', null, head, h('div', { className: 'ua-donut-wrap' },
        h('div', { className: 'ua-donut', style: { width: size, height: size } },
          h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img', 'aria-label': t('chart.tokens') },
            h('circle', { cx: center, cy: center, r: radius, fill: 'none', stroke: T.layer2, strokeWidth: thickness }),
            h('g', { transform: 'rotate(-90 ' + center + ' ' + center + ')' },
              ...ring.map((segment) => h('circle', {
                key: segment.key, cx: center, cy: center, r: radius, fill: 'none', stroke: segment.color,
                strokeWidth: thickness, strokeDasharray: segment.length + ' ' + Math.max(0, circumference - segment.length),
                strokeDashoffset: segment.dashoffset,
              })))),
          h('div', { className: 'ua-donut-center' }, h('b', null, fmtCompact(total)), h('span', null, 'Tokens'))),
        h('div', { className: 'ua-legend' }, ...items.map((item) => h('div', { className: 'ua-legend-row', key: item.key },
          h('span', { className: 'ua-legend-dot', style: { background: item.color } }),
          h('span', { className: 'ua-legend-name', title: item.label }, item.label),
          h('span', { className: 'ua-legend-val' }, fmtCompact(item.value)),
          h('span', { className: 'ua-legend-pct' }, fmtPercent(total > 0 ? item.value / total : 0)))))))
    }

    // -------------------------------------------------------------------
    // 模型分布横向条
    // -------------------------------------------------------------------
    function ModelBars(props) {
      const t = props.t
      const models = Array.isArray(props.models) ? props.models : []
      if (models.length === 0) return h('div', { className: 'ua-bar-empty' }, t('empty.chart'))
      return h('div', { className: 'ua-bars' }, ...models.slice(0, 8).map((model, index) => h('div', {
        className: 'ua-bar-row', key: model.model ?? 'model' + index,
      },
        h('div', { className: 'ua-bar-top' },
          h('span', { className: 'ua-bar-name', title: model.model }, shortModel(model.model)),
          h('span', { className: 'ua-bar-num' }, fmtCost(model.cost) + ' · ' + fmtPercent(model.share))),
        h('div', { className: 'ua-bar-track' },
          h('span', { style: { width: Math.max(2, clamp01(num(model.share)) * 100) + '%', background: C.palette[index % C.palette.length] } })))))
    }

    // -------------------------------------------------------------------
    // 峰谷对比
    // -------------------------------------------------------------------
    function PeakValley(props) {
      const t = props.t
      const overview = props.overview || {}
      const peak = num(overview.peakCost)
      const valley = num(overview.valleyCost)
      const total = Math.max(peak + valley, 1e-9)
      const saved = num(overview.savedValley)
      const savedPercent = num(overview.cost) > 0 ? saved / num(overview.cost) : 0
      const row = (label, color, cost, steps) => h('div', { className: 'ua-pv-row', key: label },
        h('span', { className: 'ua-pv-name' }, label),
        h('div', { className: 'ua-pv-track' }, h('span', { style: { width: clamp01(cost / total) * 100 + '%', background: color } })),
        h('span', { className: 'ua-pv-num' }, t('pv.summary', { cost: fmtCost(cost), steps: fmtInt(steps) })))
      return h('div', null,
        h('div', { className: 'ua-pv' },
          row(t('pv.peak'), T.warn, peak, overview.peakSteps),
          row(t('pv.valley'), T.success, valley, overview.valleySteps)),
        h('div', { className: 'ua-saved' }, icon('check', 12),
          h('span', null, t('pv.saved', { cost: fmtCost(saved), percent: fmtPercent(savedPercent) }))),
        num(overview.feeCost) > 0
          ? h('div', { className: 'ua-fee', title: t('pv.fees.hint') },
              icon('check', 12),
              h('span', null, t('pv.fees', {
                cost: fmtCostFine(overview.feeCost),
                search: fmtInt(overview.searchRequests),
                fetch: fmtInt(overview.fetchRequests),
              })))
          : null)
    }

    // -------------------------------------------------------------------
    // 最近记录（按 (session, turn) 分组，默认全部折叠）
    // -------------------------------------------------------------------
    const STEP_LIMIT = 60

    function RecentRecords(props) {
      const t = props.t
      const groups = Array.isArray(props.groups) ? props.groups : []
      const [expanded, setExpanded] = useState(() => new Set())
      const [allOpen, setAllOpen] = useState(false)
      const keys = useMemo(() => groups.map((group) => String(group.sessionId) + '#' + String(group.turn)), [groups])
      if (groups.length === 0) {
        return h('div', { className: 'ua-card' }, h('div', { className: 'ua-recent-head' },
          h('span', { className: 'ua-card-title' }, t('recent.title')),
          h('span', { className: 'ua-card-hint' }, t('empty.recent'))))
      }
      const isOpen = (key) => allOpen || expanded.has(key)
      const toggleGroup = (key) => {
        if (allOpen) {
          setAllOpen(false)
          setExpanded(new Set(keys.filter((item) => item !== key)))
          return
        }
        const next = new Set(expanded)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        setExpanded(next)
      }
      const toggleAll = () => {
        if (allOpen) {
          setAllOpen(false)
          setExpanded(new Set())
        } else setAllOpen(true)
      }
      return h('div', { className: 'ua-card ua-recent' },
        h('div', { className: 'ua-recent-head' },
          h('span', { className: 'ua-card-title' }, t('recent.title')),
          h('span', { className: 'ua-card-hint' }, t('recent.meta', { turns: fmtInt(props.turns), steps: fmtInt(props.steps) })),
          h('button', { type: 'button', className: 'ua-daybar-link', onClick: toggleAll, style: { marginLeft: 'auto', fontSize: '11px' } },
            allOpen ? t('recent.collapse') : t('recent.expand'))),
        h('div', { className: 'ua-recent-list' }, ...groups.map((group, index) => {
          const key = keys[index]
          const open = isOpen(key)
          const steps = Array.isArray(group.steps) ? group.steps : []
          return h('div', { key },
            h('div', {
              className: 'ua-group' + (open ? ' open' : ''), role: 'button', tabIndex: 0,
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => toggleGroup(key),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggleGroup(key)
                }
              },
            },
              h('span', { className: 'ua-chev' }, icon('right', 12)),
              props.showSessionBadge && group.label ? h('span', { className: 'ua-badge', title: group.label }, group.label) : null,
              h('span', { className: 'ua-group-title' }, t('recent.turn', { turn: fmtInt(group.turn) })),
              h('span', { className: 'ua-model', title: group.model }, shortModel(group.model)),
              h('span', { className: 'ua-money' }, fmtCost(group.cost)),
              tag(group.peak, t)),
            open ? h('div', null,
              ...steps.slice(0, STEP_LIMIT).map((step, stepIndex) => h('div', { className: 'ua-step', key: 's' + stepIndex },
                h('span', { className: 'ua-step-title' }, t('recent.step', { turn: fmtInt(group.turn), step: fmtInt(step.step) })),
                h('span', { className: 'ua-model', title: step.model }, shortModel(step.model)),
                h('span', { className: 'ua-step-mix' }, t('recent.mix', {
                  input: fmtCompact(step.input), cacheRead: fmtCompact(step.cacheRead), output: fmtCompact(step.output),
                })),
                h('span', { className: 'ua-step-money' }, fmtCostFine(step.cost)),
                tag(step.peak, t))),
              steps.length > STEP_LIMIT ? h('div', { className: 'ua-more' }, t('recent.more', { n: fmtInt(steps.length - STEP_LIMIT) })) : null)
              : null)
        })))
    }

    // -------------------------------------------------------------------
    // 仪表盘（顶栏筛选 + 日期条 + 卡片 + 图表 + 最近记录）
    // -------------------------------------------------------------------
    const RANGE_OPTIONS = ['today', '7d', '30d', '90d', 'all']
    const RANGE_KEYS = { today: 'range.today', '7d': 'range.7d', '30d': 'range.30d', '90d': 'range.90d', all: 'range.all' }

    function Dashboard(props) {
      const t = props.t
      const sessionId = props.sessionId
      const [range, setRange] = useState('7d')
      const [sessionScope, setSessionScope] = useState('all')
      const [model, setModel] = useState('all')
      const [day, setDay] = useState(props.previewDay || '')
      const [data, setData] = useState(props.previewData || null)
      const [loading, setLoading] = useState(!props.previewData)
      const [failed, setFailed] = useState(false)
      const [refreshToken, setRefreshToken] = useState(0)
      const requestSeq = useRef(0)
      const controllerRef = useRef(null)
      const forceRef = useRef(false)
      const scope = sessionScope === 'current' && sessionId ? 'current' : 'all'
      const todayKey = useMemo(() => dayKeyOf(Date.now()), [])

      const query = useMemo(() => {
        const params = new URLSearchParams()
        params.set('range', range)
        params.set('session', scope)
        if (scope === 'current' && sessionId) params.set('sid', sessionId)
        if (model && model !== 'all') params.set('model', model)
        if (day) params.set('day', day)
        return params.toString()
      }, [range, scope, sessionId, model, day])

      useEffect(() => {
        if (props.previewData) return undefined
        // 竞态保护：自增 requestId + AbortController，旧响应不得覆盖新响应。
        const requestId = requestSeq.current + 1
        requestSeq.current = requestId
        if (controllerRef.current) {
          try { controllerRef.current.abort() } catch { /* ignore */ }
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        controllerRef.current = controller
        const force = forceRef.current
        forceRef.current = false
        const url = API + '/summary?' + query + (force ? '&refresh=1' : '')
        let disposed = false
        setLoading(true)
        fetchJson(url, controller ? { signal: controller.signal } : undefined)
          .then((payload) => {
            if (disposed || requestId !== requestSeq.current) return
            setData(payload)
            setFailed(false)
          })
          .catch((error) => {
            if (disposed || requestId !== requestSeq.current) return
            if (error && error.name === 'AbortError') return
            setFailed(true) // 静默降级：保留上次 data
          })
          .finally(() => {
            if (disposed || requestId !== requestSeq.current) return
            setLoading(false)
          })
        return () => {
          disposed = true
          if (controller) {
            try { controller.abort() } catch { /* ignore */ }
          }
        }
      }, [query, refreshToken])

      const refresh = useCallback(() => {
        forceRef.current = true
        setRefreshToken((value) => value + 1)
      }, [])

      const overview = (data && data.overview) || {}
      const days = useMemo(() => (data && Array.isArray(data.days) ? data.days : []), [data])
      const models = useMemo(() => (data && Array.isArray(data.models) ? data.models : []), [data])
      const groups = useMemo(() => (data && Array.isArray(data.groups) ? data.groups : []), [data])
      const hourly = useMemo(() => (data && Array.isArray(data.hourly) ? data.hourly : []), [data])
      const tokenMix = (data && data.tokenMix) || {}
      const modelMix = useMemo(() => (data && Array.isArray(data.modelTokenMix) ? data.modelTokenMix : []), [data])
      const hasData = num(overview.steps) > 0 || groups.length > 0
      const modelOptions = useMemo(() => {
        const seen = new Set()
        const list = []
        for (const entry of models) {
          const name = String((entry && entry.model) || '')
          if (!name || seen.has(name)) continue
          seen.add(name)
          list.push(name)
        }
        if (model !== 'all' && !seen.has(model)) list.unshift(model)
        return [{ value: 'all', label: t('model.all') }].concat(list.map((name) => ({ value: name, label: name })))
      }, [models, model, t])

      const head = h('div', { className: 'ua-head' },
        h('div', { className: 'ua-titlewrap' },
          h('h2', { className: 'ua-title' }, t('panel.title')),
          data && data.generatedAt ? h('span', { className: 'ua-head-meta' }, t('panel.updated', { time: fmtTime(data.generatedAt) })) : null),
        h('div', { className: 'ua-filters' },
          Segmented({
            value: range, label: t('range.label'),
            options: RANGE_OPTIONS.map((value) => ({ value, label: t(RANGE_KEYS[value]) })),
            onChange: (value) => { setDay(''); setRange(value) },
          }),
          Segmented({
            value: scope, label: t('session.label'),
            options: [
              { value: 'all', label: t('session.all') },
              { value: 'current', label: t('session.current'), disabled: !sessionId, title: sessionId ? undefined : t('session.unavailable') },
            ],
            onChange: (value) => setSessionScope(value),
          }),
          h('select', {
            className: 'ua-select', value: model, 'aria-label': t('model.label'), title: t('model.label'),
            onChange: (event) => setModel(event.target.value),
          }, ...modelOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
          h('button', {
            type: 'button', className: 'ua-icon-btn', title: t('action.refresh'), 'aria-label': t('action.refresh'),
            onClick: refresh, disabled: loading,
          }, h('span', { className: 'ua-glyph' + (loading ? ' ua-spin' : ''), 'aria-hidden': 'true' }, '⟳')),
          h('button', {
            type: 'button', className: 'ua-icon-btn', title: t('action.close'), 'aria-label': t('action.close'),
            onClick: props.onClose,
          }, icon('close', 14))))

      const dayBar = day ? h('div', { className: 'ua-daybar' },
        h('button', { type: 'button', className: 'ua-icon-btn', title: t('day.prev'), 'aria-label': t('day.prev'),
          onClick: () => setDay(shiftDayKey(day, -1)) }, icon('left', 14)),
        h('b', null, day),
        h('button', { type: 'button', className: 'ua-icon-btn', title: t('day.next'), 'aria-label': t('day.next'),
          disabled: day >= todayKey, onClick: () => setDay(shiftDayKey(day, 1)) }, icon('right', 14)),
        h('button', { type: 'button', className: 'ua-daybar-link', onClick: () => setDay('') }, t('day.back'))) : null

      const body = []
      if (failed && data) body.push(h('div', { className: 'ua-notice', key: 'notice' }, t('error.load')))
      if (!data) {
        body.push(h('div', { className: 'ua-loading', key: 'loading' }, failed ? t('error.first') : t('loading')))
      } else {
        body.push(h(StatCards, { key: 'stats', t, overview }))
        if (hasData) {
          body.push(h('div', { className: 'ua-grid2', key: 'charts1' },
            card(t, day ? t('chart.hourly') : t('chart.trend'), day ? t('chart.hourly.hint') : t('chart.trend.hint'),
              day ? h(HourlyChart, { t, hourly }) : h(LineChart, { t, days, onSelectDay: (value) => setDay(value) })),
            h('div', { className: 'ua-card' }, h(TokenDonut, { t, tokenMix, modelMix }))))
          body.push(h('div', { className: 'ua-grid2', key: 'charts2' },
            card(t, t('chart.models'), t('chart.models.hint'), h(ModelBars, { t, models })),
            card(t, t('chart.pv'), fmtCost(overview.cost), h(PeakValley, { t, overview }))))
          body.push(h(RecentRecords, {
            key: 'recent', t, groups, turns: overview.turns, steps: overview.steps,
            showSessionBadge: (data.session || 'all') === 'all',
          }))
        } else body.push(emptyBlock(t, 'empty'))
      }

      return h('div', { className: 'ua-panel-inner' },
        head, dayBar,
        h('div', { className: 'ua-body', 'aria-busy': loading ? 'true' : undefined }, ...body))
    }

    // -------------------------------------------------------------------
    // 坞：conversation.composer.dock
    // -------------------------------------------------------------------
    function Dock(props) {
      const t = props.t
      const sessionId = props.sessionId
      const [live, setLive] = useState(null)
      const [balance, setBalance] = useState(null)
      const [clock, setClock] = useState(() => Date.now())

      useEffect(() => { if (sessionId) activeSessionId = sessionId }, [sessionId])

      // 1s 时钟：驱动坞上的时刻、进度条与倒计时。
      useEffect(() => {
        const timer = setInterval(() => setClock(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [])

      // live 每 15s；卸载清 interval，旧响应丢弃。
      useEffect(() => {
        let disposed = false
        let seq = 0
        const load = () => {
          const requestId = ++seq
          fetchJson(API + '/live' + (sessionId ? '?sid=' + encodeURIComponent(sessionId) : ''))
            .then((payload) => { if (!disposed && requestId === seq) setLive(payload) })
            .catch(() => { /* 静默降级：保留上次数据 */ })
        }
        load()
        const timer = setInterval(load, 15000)
        return () => { disposed = true; clearInterval(timer) }
      }, [sessionId])

      // balance 每 60s；失败显示 —。
      useEffect(() => {
        let disposed = false
        let seq = 0
        const load = () => {
          const requestId = ++seq
          fetchJson(API + '/balance')
            .then((payload) => { if (!disposed && requestId === seq) setBalance(payload) })
            .catch(() => { /* 静默降级 */ })
        }
        load()
        const timer = setInterval(load, 60000)
        return () => { disposed = true; clearInterval(timer) }
      }, [])

      const period = live && live.period ? live.period : null
      const kind = period ? period.kind : live && typeof live.peak === 'boolean' ? (live.peak ? 'peak' : 'valley') : null
      const isPeak = kind === 'peak'
      const dotColor = kind === 'peak' ? T.warn : kind === 'valley' ? T.success : T.text3
      const progress = period ? clamp01(period.progress) : 0
      const nextAt = period ? num(period.nextAt) : 0
      const remaining = nextAt > 0 ? Math.max(0, nextAt - clock) : null
      const sessionCost = live && live.session ? num(live.session.cost) : null
      const turnCost = live && live.turn ? num(live.turn.cost) : null
      const balanceText = balance && balance.ok === true && balance.total !== null && balance.total !== undefined
        ? String(balance.currency || 'CNY') + ' ' + fmtBalance(balance.total) : '—'
      const openPanel = () => setPanelOpen(true)

      return h('div', {
        className: 'ua-dock', role: 'button', tabIndex: 0, 'aria-label': t('dock.open'), onClick: openPanel,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPanel()
          }
        },
      },
        h('span', { className: 'ua-dock-group' },
          h('span', { className: 'ua-dot', style: { background: dotColor, color: dotColor } }),
          h('span', null, kind === 'peak' ? t('dock.peak') : kind === 'valley' ? t('dock.valley') : '—'),
          h('span', { className: 'ua-dock-time' }, fmtTime(clock))),
        h('span', { className: 'ua-dock-track', 'aria-hidden': 'true' },
          h('span', { style: { width: progress * 100 + '%', background: dotColor } })),
        remaining !== null ? h('span', { className: 'ua-dock-group ua-dock-count' },
          t('dock.next', { label: isPeak ? t('dock.valley') : t('dock.peak') }) + ' ' + fmtCountdown(remaining)) : null,
        h('span', { className: 'ua-dock-divider', 'aria-hidden': 'true' }),
        h('span', { className: 'ua-dock-group' },
          h('span', null, t('dock.session')),
          h('b', null, sessionCost === null ? '—' : '≈' + fmtCost(sessionCost))),
        h('span', { className: 'ua-dock-mid', 'aria-hidden': 'true' }, '·'),
        h('span', { className: 'ua-dock-group' },
          h('span', null, t('dock.turn')),
          h('b', null, turnCost === null ? '—' : fmtCost(turnCost))),
        h('span', { className: 'ua-dock-divider', 'aria-hidden': 'true' }),
        h('span', { className: 'ua-dock-group' }, h('span', null, t('dock.balance')), h('b', null, balanceText)),
        h('button', {
          type: 'button',
          className: 'ua-dock-expand',
          title: t('dock.expand'),
          'aria-label': t('dock.open'),
          onClick: (event) => {
            event.stopPropagation()
            openPanel()
          },
        }, t('dock.expand'), icon('down', 12)))
    }

    // -------------------------------------------------------------------
    // 浮层：shell.overlay（未打开时 return null；打开时遮罩 + 居中面板）
    // -------------------------------------------------------------------
    function Overlay(props) {
      const t = props.t
      const [open] = usePanelOpen()
      const isOpen = open || props.previewOpen === true

      // Esc 关闭 + 锁页面滚动；卸载时全部清理。
      useEffect(() => {
        if (!isOpen || typeof document === 'undefined') return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' || event.key === 'Esc') {
            event.preventDefault()
            event.stopPropagation()
            setPanelOpen(false)
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        const previousOverflow = document.body ? document.body.style.overflow : ''
        if (document.body) document.body.style.overflow = 'hidden'
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          if (document.body) document.body.style.overflow = previousOverflow
        }
      }, [isOpen])

      if (!isOpen) return null
      return h('div', {
        className: 'ua-mask',
        onClick: (event) => { if (event.target === event.currentTarget) setPanelOpen(false) },
      }, h('div', { className: 'ua-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('panel.aria') },
        h(Dashboard, {
          t,
          sessionId: props.sessionId || activeSessionId,
          previewData: props.previewData,
          previewDay: props.previewDay,
          onClose: () => setPanelOpen(false),
        })))
    }

    // -------------------------------------------------------------------
    // 注册：样式 + locale + 两个 slot
    // -------------------------------------------------------------------
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        let t = makeTranslator(ZH)
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function') ctx.locale.register(NS, { zh: ZH, en: EN })
          if (ctx.locale && typeof ctx.locale.bind === 'function') {
            const bound = ctx.locale.bind(NS)
            if (typeof bound === 'function') t = (key, params) => bound(key, params)
          }
        } catch (error) {
          try { console.warn('[usage-analytics] locale 注册失败，使用内置中文文案', error) } catch { /* ignore */ }
        }

        const installStyles = () => {
          try {
            if (typeof document === 'undefined' || !document.head) return
            if (document.getElementById(STYLE_ID)) return
            const element = document.createElement('style')
            element.id = STYLE_ID
            element.textContent = CSS
            document.head.appendChild(element)
          } catch { /* 样式注入失败不影响功能 */ }
        }
        const removeStyles = () => {
          try {
            if (typeof document === 'undefined') return
            const element = document.getElementById(STYLE_ID)
            if (element && element.parentNode) element.parentNode.removeChild(element)
          } catch { /* ignore */ }
        }
        if (typeof ctx.effect === 'function') ctx.effect(() => {
          installStyles()
          return removeStyles
        }, 'usage-analytics: styles')
        else installStyles()

        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return
        const mount = (name, component, options) => () => ctx.slots.inject(name, () => ctx.slots.register(options, component))

        if (typeof ctx.effect === 'function') {
          // 坞：session 作用域，inject 回调拿 sessionId 作为组件 props（同 composer.bar 的写法）。
          ctx.effect(mount('conversation.composer.dock', (props) => h(Dock, { ...props, t }), {
            name: 'conversation.composer.dock',
            id: 'usage-dashboard',
            order: 2,
            locale: NS,
            label: () => t('dock.title'),
            inject: (sessionId) => (sessionId ? { sessionId } : {}),
          }), 'usage-analytics: dock')
          // 浮层：shell 作用域，order 60。
          ctx.effect(mount('shell.overlay', (props) => h(Overlay, { ...props, t }), {
            name: 'shell.overlay',
            id: 'usage-dashboard',
            order: 60,
            locale: NS,
          }), 'usage-analytics: overlay')
        }
      },
    }
  },
})
