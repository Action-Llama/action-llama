---
"@action-llama/action-llama": patch
---

Make the gateway opt-in via `al start -g` instead of starting automatically.
The `--web-ui` flag now requires `-g`. Webhooks also require the gateway;
a warning is logged if agents have webhook triggers but `-g` was not passed.

Agents now use `rlock`, `runlock`, `rlock-heartbeat`, and `al-shutdown` shell
commands instead of raw curl. These are written to `/tmp/bin/` at container
startup and gracefully no-op when `GATEWAY_URL` is not set, allowing scale=1
cloud agents to run with a local scheduler without a gateway.

Removed the credential-fetch and log-forwarding gateway routes that are no
longer used (credentials are always injected via volume mounts or env vars).
