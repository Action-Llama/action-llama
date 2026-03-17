---
"@action-llama/action-llama": patch
---

The HTTP gateway now starts automatically with `al start` — the `--gateway` (`-g`) flag has been removed. This means `al pause`, `al resume`, `al kill`, and `al stop` work out of the box without needing to remember the flag. The `--expose` flag still controls whether the gateway binds to `0.0.0.0` (public) or `127.0.0.1` (local only, the default).
