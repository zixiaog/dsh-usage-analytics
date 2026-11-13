# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-13

### Fixed

- **Cost estimates were roughly 7× too high for `deepseek-flash`.** The built-in price table
  used ¥0.5/M for cache-hit input, but the official DeepSeek price is ¥0.04/M at peak
  (¥0.02 off-peak) — and cache hits are ~99 % of the token count, so the error dominated
  every number. The table now matches the official
  [pricing page](https://api-docs.deepseek.com/quick_start/pricing):
  `deepseek-flash` hit `0.04`/`0.02`, miss `2`/`1`, output `8`/`4`;
  `deepseek-v4-pro` hit `0.30`/`0.15`, miss `9`/`4.5`, output `27`/`13.5`
  (CNY per 1M tokens, peak/off-peak).
- **Cache writes are no longer priced separately** — DeepSeek bills them inside the cache-miss
  input price, so `cacheWrite` is `0` in the built-in table.
- Peak/valley classification now supports excluding Chinese public holidays through the new
  `offPeakDates` config key (the official schedule excludes them).

### Added

- **Automatic re-pricing of history.** Every stored step now records the price-table version
  (`pv`) it was priced with. When an upgrade changes the table, the store recalculates the
  existing records from their stored token counts on the next start and rewrites the file once;
  token counts are never modified. `GET /usage-dashboard/api/health` reports the active
  price-table version.
- New pricing tests: the official `deepseek-flash` rates, the zero cache-write price, and
  `offPeakDates` handling. Store test covers the re-pricing rewrite.

### Changed

- README (EN/ZH) documents the official CNY price table, the cache-hit/cache-write pitfalls,
  the holiday limitation and the automatic re-pricing behaviour.

## [0.1.2] - 2026-11-13

### Added

- **`upstream-watch` GitHub Actions workflow**: every Monday it asks npm for the newest
  `@deepseek-ai/dsh`, compares it with [`.github/dsh-verified-version`](.github/dsh-verified-version)
  and opens an `upstream`-labelled issue with a compatibility checklist when DSH has moved
  on. Manual runs are supported via `workflow_dispatch`.
- README now documents the automated watch next to the manual update policy.

## [0.1.1] - 2026-11-13

### Added

- **"Supports the latest DSH · continuously updated"** statement on the README front
  page, plus `maintained` / `updates: continuous` badges.
- **Compatibility & maintenance** section: names the exact verified DSH versions
  (`0.2.2-rc.1` on `latest`, `0.2.2-rc.2` on `next`), lists every upstream contract the
  plugin depends on (session persistence, the `session/event` firehose, `webServer`
  routes, `deepseekAccount`, the two slot keys, theme tokens), and states the update
  policy: upstream changes ship a matching plugin release, and the verified DSH version
  is raised, never lowered.
- **README preview section and `docs/screenshots/`**: cover, dashboard, dock,
  date drill-down, this-session scope and cross-session history, captured from a real DSH
  Web instance with the plugin installed (balance masked in the dock shots).

### Changed

- Promo cover image now carries the maintenance promise as well.

## [0.1.0] - 2026-11-12

### Added

- **Peak/off-peak billing dock** under the composer: current price period, progress
  through the period, countdown to the next switch, session cost, current-turn cost and
  account balance, with 15 s live / 60 s balance refresh.
- **Full usage dashboard** in a full-screen overlay: time-range, session-scope and model
  filters, six stat cards (cost, tokens, turns, cache hit rate, valley savings, average
  cost per step), cost trend line, token-structure donut, model distribution bars and a
  peak/valley comparison.
- **Date drill-down**: click a day in the trend chart for 24-hour peak/valley bars,
  step through neighbouring dates and jump back to the current range.
- **Recent records** grouped by turn, expandable down to individual steps with
  input / cache-read / output tokens and per-step cost.
- **Durable cross-session history** appended to
  `<DSH_HOME>/storages/usage-analytics.jsonl`, backfilled from existing session logs,
  kept current by live capture on `session/event` and periodic re-scans, with a
  configurable soft cap (`historyLimit`, 40,000 by default) that trims the oldest steps.
- **Peak/valley pricing** on Beijing-time weekday windows `09:00–12:00` and
  `14:00–18:00` (full price) with every other time and all weekends at
  `valleyFactor` (0.5 by default), overridable per model through the `prices` config key.
- **Account balance** read from the signed-in DeepSeek platform account, shown as `—`
  when unavailable.
- **Configuration** through the plugin row: `prices`, `peakHours`, `storagePath` and
  `debug`, plus advanced `peakWindows`, `peakDays`, `valleyFactor`, `storageDir` and
  `historyLimit`.
- **Localized UI** (Simplified Chinese and English) following the DSH theme tokens.
- **Project tooling**: unit tests on the `node:test` runner (`npm test`), a static check
  script (`npm run check`), and a GitHub Actions workflow that runs both on Node 20.
- **Docs**: English and Chinese README, design notes, contributing guide, security policy
  and MIT license.

### Fixed

- Changing dashboard filters quickly no longer lets a stale response overwrite the newer
  one; each request is tracked and only the latest result is applied.
- Closing and reopening the dashboard no longer accumulates polling intervals, document
  listeners or injected style elements — all of them are cleaned up on unmount.
- The dock renders `—` placeholders on first paint instead of collapsing and reflowing
  once the first payload arrives.
- A failed balance lookup degrades silently to `—` instead of surfacing an error in the
  composer or the dashboard.

[0.1.0]: https://github.com/zixiaog/dsh-usage-analytics/releases/tag/v0.1.0
[0.1.1]: https://github.com/zixiaog/dsh-usage-analytics/releases/tag/v0.1.1
[0.1.2]: https://github.com/zixiaog/dsh-usage-analytics/releases/tag/v0.1.2
[0.2.0]: https://github.com/zixiaog/dsh-usage-analytics/releases/tag/v0.2.0
