---
"@action-llama/action-llama": patch
---

Fixed resource locks failing silently on VPS deployments. The gateway bound to
127.0.0.1 which was unreachable from Docker containers via the bridge network;
the systemd unit now passes `--expose` so the gateway binds to 0.0.0.0. The
`rlock` script also lacked an error fallback (unlike `runlock`/`rlock-heartbeat`),
so agents received empty output on failure and proceeded without acquiring a lock.
`rlock` now returns `{"ok":false,"reason":"gateway unreachable"}` when the gateway
is down, and all lock scripts include curl timeouts to fail fast.
