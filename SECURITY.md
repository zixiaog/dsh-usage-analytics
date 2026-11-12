# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1 | ❌ |

## Reporting a vulnerability

Please do not report security issues in a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/zixiaog/dsh-usage-analytics/security/advisories/new)
for this repository. If that is unavailable, contact the maintainers through the contact
details on their GitHub profiles.

Please include:

- the affected plugin version and DSH version;
- reproduction steps, kept as small as possible — do not attach real session logs or account
  data;
- the impact you believe it has (for example: forged usage records, a path escaping the
  history file, a request that reads another origin's data, a balance credential leak);
- a suggested fix, if you have one.

## Threat model

This is a **local, single-user tool**. It assumes:

- the DSH Web UI listens on the loopback interface and is not exposed to an untrusted network;
- the person using the plugin owns the machine and the DSH profile;
- the plugin runs with the same permissions as the DSH host process and can read the
  profile's session data.

What the plugin does about it:

- all routes live under the `/usage-dashboard` prefix: `GET` on `summary`, `live`, `balance`
  and `health`, plus a `POST`/`GET` `sync` route whose only effect is to re-read session
  logs into the plugin's own store. No endpoint deletes or rewrites session data;
- responses are served with `cache-control: no-store`, and the client always requests with
  `cache: 'no-store'`;
- the storage directory defaults to `<DSH_HOME>/storages`; an override is resolved with
  `path.resolve`, so a relative override follows the DSH process working directory — use an
  absolute path if the working directory is not trusted;
- the only network access is the balance lookup through DSH's `deepseekAccount` service,
  using the account already signed in to DSH — the plugin asks for no separate credentials
  and stores none;
- no telemetry, analytics or third-party requests are made, and usage data never leaves the
  machine except as part of that balance lookup.

Out of scope:

- an attacker who already has your OS account — with the same permissions they can read the
  history file and session logs directly;
- the accuracy of the cost estimate (it is documented as an estimate, not a bill);
- misconfiguration of DSH itself, such as exposing the Web UI to a network (report that to
  DSH).

## Good practice

- Keep the DSH Web UI bound to localhost;
- install the plugin from npm or this repository only, and check the version you install;
- delete `<DSH_HOME>/storages/usage-analytics.jsonl` (and its `usage-analytics.meta.json`
  companion) if you want to remove the usage history the plugin has collected;
- if you find something that looks like a vulnerability, report it privately rather than
  discussing it in a chat or an issue.
