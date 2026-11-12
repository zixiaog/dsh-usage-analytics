# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
