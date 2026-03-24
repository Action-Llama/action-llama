---
"@action-llama/action-llama": patch
---

Fix sentry webhook extension metadata to reference `sentry_client_secret` instead of
the non-existent `sentry_webhook_secret` credential type. The runtime already used the
correct type; only the extension metadata was inconsistent.

Also fix documentation inconsistencies: add missing `al stats` and `al webhook replay`
command references, document all `[telemetry]` fields, document `[agents.<name>]`
per-agent overrides, document `historyRetentionDays`, document the `/dashboard/triggers`
page and trigger history API, fix `al logs` signature to show agent as optional, add
`--strict` flag to `al doctor`, and remove stale `--no-docker` reference.
