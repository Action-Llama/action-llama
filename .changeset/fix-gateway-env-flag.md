---
"@action-llama/action-llama": patch
---

Fixed `-E`/`--env` flag being ignored by `al logs`, `al stat`, `al pause`, `al resume`,
`al kill`, and `al chat` when connecting to the gateway. These commands always connected to
`http://localhost:<port>` instead of using the `gateway.url` from the selected environment,
so remote environments showed stale local data instead of live remote logs/status.
