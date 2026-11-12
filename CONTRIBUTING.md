# Contributing

Thanks for taking the time to improve `dsh-usage-analytics`. It is a local DSH plugin:
the host half reads token usage from DSH and writes a history file, the client half renders
a dock under the composer and a dashboard overlay. Please keep changes small, verifiable
and honest about their limits.

## Environment

- DSH `0.2.x` with the Web UI (web profile)
- Node.js `>= 20` for the tests and checks; the plugin itself has no runtime dependencies
- No build step or bundler — `client.js` is loaded by DSH as a dynamic module

## Project layout

```text
index.js             host entry: config, live capture, sync scheduling, HTTP routes
lib/api.js           HTTP handler (summary / live / balance / health / sync)
lib/aggregate.js     filters -> summary and live payloads (pure functions)
lib/pricing.js       peak/valley windows, price table, step cost, current period
lib/scan.js          session event -> usage record, dedup key
lib/store.js         JSONL history store and per-session meta file
lib/sync.js          sessionPersistence backfill with watermarks
lib/util.js          DSH_HOME resolution, atomic writes, helpers
client.js            client module: dock + dashboard (window.__ModuleLoader__)
locale/              plugin-manager metadata (zh/en)
cordis.patch.yml     bundle patch that inserts the plugin row
test/                node:test suites
scripts/test.mjs     test entry (imports the suites into one process)
scripts/check.mjs    static checks (syntax, JSON, manifest consistency)
docs/                design notes
```

The host half must only use Node built-ins and the services DSH injects into the plugin
context (`webServer`, `sessionPersistence`, `deepseekAccount`) — never import packages from
the DSH installation. The client half may only `require('react')`; the rest of the UI is
plain `React.createElement` and injected CSS. Colors come from DSH theme tokens
(`--dsw-alias-*`, `--dsw-static-*`), never hard-coded light or dark values.

## Local development loop

1. Install this directory into a scratch profile (plugin manager, or
   `dsh plugin --profile <profile> add <absolute-path>`).
2. Edit `client.js`, then reload the DSH Web page.
3. Edit host files (`index.js`, `lib/*`), then restart DSH or disable/enable the plugin row
   so the new host code is mounted.
4. Run the checks below before opening a PR.

Point `storageDir` in the plugin config at a scratch directory while testing so experiments
do not mix with your real usage history.

## Self-check

```bash
npm test        # node scripts/test.mjs — runs the node:test suites in one process
npm run check   # node scripts/check.mjs
```

Both must pass. Then check by hand:

- [ ] the dock appears under the composer and its values fill in within a few seconds;
- [ ] the dashboard opens from the dock and closes with `×`, `Esc` and a backdrop click;
- [ ] every time-range / session / model filter updates all cards and charts;
- [ ] clicking a day drills down, `‹` / `›` move the date, and "back to today" returns;
- [ ] recent records expand per turn down to steps;
- [ ] refresh and polling do not leak intervals after the panel is closed;
- [ ] the browser console stays free of errors and warnings.

If you touch pricing, include the price table and the peak/valley window you used in the
PR description, since estimates depend on both.

## Pull requests

- One PR, one concern. Use conventional commit subjects (`feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`).
- Describe the user-visible change, how you verified it, and any tradeoff or limitation.
- Include a screenshot when you change the dock or dashboard layout.
- Do not commit `node_modules/`, local history files, logs, or screenshots containing
  personal data (session titles, project paths, account numbers).
- Do not bump the version or edit `CHANGELOG.md` in a feature PR; releases are cut by the
  maintainers.

## Security

Please report security issues privately — see [SECURITY.md](SECURITY.md). Do not open a
public issue for them.
