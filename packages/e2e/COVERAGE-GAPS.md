# E2E Coverage Gaps

Priority list of untested or under-tested e2e flows. The `e2e-coverage-improver`
agent reads this file and works top-down. Mark items `[x]` when a test exists.

## High Priority

- [x] Webhook trigger handling — deliver a mock webhook payload and verify agent execution (cli-flows.test.ts has a `todo` placeholder)
- [x] Scheduler cron triggering — verify agents fire on schedule and not before
- [x] Error: invalid credentials — start scheduler with bad/missing credentials, verify graceful error
- [x] Error: Docker unavailable — start scheduler when Docker CLI fails, verify error reporting
- [x] Error: SSH connection failure during VPS deploy — simulate SSH timeout, verify rollback behavior
- [x] Multi-agent scheduling — configure 3+ agents with different schedules, verify independent execution
- [x] Agent timeout enforcement — configure short timeout, verify agent is killed after expiry

## Medium Priority

- [x] Agent concurrent scaling — set `scale = 2`, trigger two events, verify parallel execution
- [x] Webhook event filtering — deliver events that don't match labels/actions/branches, verify they are ignored
- [x] Scheduler pause/resume with in-flight agents — pause while agent is running, verify it completes
- [x] MCP server integration — start scheduler with MCP config, verify MCP tools are available to agents
- [x] Extension loading — configure an extension, verify it loads and registers
- [x] Dashboard SSE reconnection — disconnect SSE stream, verify auto-reconnect and data continuity
- [x] Credential rotation — update credentials while scheduler is running, verify new creds are used

## Lower Priority

- [x] Agent-to-agent communication — one agent triggers another via `al-rerun`
- [x] Log streaming — verify `al logs` streams live output from running agents
- [x] Deployment with custom Dockerfile — push agent with custom Dockerfile, verify image build
- [x] Deployment upgrade path — deploy v1, upgrade to v2, verify agents restart with new code
- [x] Resource lock contention — two agents competing for the same lock, verify mutual exclusion
- [x] Webhook retry/deduplication — deliver duplicate webhook, verify single execution
- [x] Stats and usage tracking — run agents, verify stats API returns correct execution counts

## Newly Identified Gaps

- [x] Chat session management — create, retrieve idempotently, delete, and clear chat sessions via REST API (chat.test.ts)
- [x] Project-level scale control API — update project scale cap at runtime, validate inputs, verify config.toml update (project-scale.test.ts)
- [x] Linear webhook provider — Issue create/update triggers, Comment event mapping, event type filtering, signature rejection (linear-webhook.test.ts)
- [x] Mintlify webhook provider — build succeeded/failed events, action filtering, signature rejection (mintlify-webhook.test.ts)
- [x] rlock/runlock URI validation — invalid URIs return exit code 4 (HTTP 400), all three lock commands covered (rlock-validation.test.ts)
- [x] Slack webhook provider — message/app_mention events, event filtering, challenge handling, signature rejection (slack-webhook.test.ts)
- [x] Discord webhook provider — PING/PONG, application_command, message_component, event filtering, Ed25519 signature rejection (discord-webhook.test.ts)
- [x] Twitter webhook provider — tweet_create, follow events, event filtering, base64-HMAC signature rejection (twitter-webhook.test.ts)
- [x] GitHub webhook provider — issues/PR/push events, label/action filters, HMAC signature rejection (github-webhook.test.ts)
- [x] Sentry webhook provider — event_alert/issue/error events, resource type filtering, HMAC signature rejection (sentry-webhook.test.ts)
- [x] Webhook replay endpoint — replay stored webhooks, 404 for missing receipts, multi-agent replay matching (webhook-replay.test.ts)
- [x] Per-agent enable/disable/pause/resume — disable prevents triggers, re-enable restores, pause/resume aliases, 404 for nonexistent (agent-enable-disable.test.ts)
- [x] Hot-reload agent removal — delete agent directory at runtime, verify runner pool gone, control API returns 404, remaining agents unaffected (hot-reload-removal.test.ts)
- [x] Hot-reload scale change — modify scale in config.toml at runtime, verify runner pool grows/shrinks, concurrency verified after scale-up (hot-reload-scale-change.test.ts)
- [x] Hot-reload webhook config change — remove/add webhook bindings via config.toml hot reload, verify binding removal stops webhook triggers, binding addition enables them (hot-reload-webhook-change.test.ts)
- [x] Gateway JSON auth API — POST /api/auth/login correct/wrong key, GET /api/auth/check with Bearer/cookie/no-auth, POST /api/auth/logout sets Max-Age=0 (gateway-auth-api.test.ts)
- [x] Per-agent scale control API — POST /control/agents/:name/scale updates config.toml, 404 for missing agent, 400 for invalid scale values (agent-scale-api.test.ts)
- [x] Lock deadlock detection — two agents holding and waiting for each other's locks triggers detectCycle(), both agents handle gracefully (lock-deadlock.test.ts)
- [x] Per-instance log API — GET /api/logs/agents/:name/:instanceId returns filtered entries, empty for unknown instance, 400 for invalid names (logs-per-instance.test.ts)
- [x] Stats API pagination — GET /api/stats/agents/:name/runs with page/limit params, verify paginated results, total count, default behavior (stats-pagination.test.ts)
- [x] Logs API grep/lines parameters — grep filters by regex, invalid grep returns 400, lines limits entry count (logs-grep.test.ts)
- [x] Stats triggers pagination/filtering — offset parameter, since time filter, triggerType filter for manual/webhook (stats-triggers-pagination.test.ts)
- [x] Control API status tracker unavailable — GET /control/instances and GET /control/status return 503 without status tracker (control-instances.test.ts)
- [x] Scheduler config validation — pi_auth rejected in container mode (ConfigError), api_key accepted (scheduler-validation.test.ts)
- [x] Manual trigger with custom prompt body — POST /control/trigger/:name with prompt field passes text to container PROMPT env var, verified in test-script (control.test.ts)
- [x] Kill specific instance by instanceId — POST /control/kill/:instanceId kills exactly the targeted runner, 404 for nonexistent instanceId (control.test.ts)
- [x] Webhook CRC challenge GET route — GET /webhooks/:source returns 404 when provider doesn't support CRC, 404 for unknown source (webhooks.test.ts)
- [x] GitHub ping event is silently ignored — parseEvent returns null for ping, registry returns ok:true with matched:0, no agents triggered (github-webhook.test.ts)
- [x] Webhook delivery deduplication — duplicate X-GitHub-Delivery ID returns duplicate:true and matched:0, no second agent trigger (github-webhook.test.ts)
- [x] Webhook receipt 404 — GET /api/stats/webhooks/:receiptId returns 404 with receipt:null for nonexistent receipt ID (webhook-stats.test.ts)
- [x] Activity endpoint status filter — ?status=completed filters to completed rows only, ?status=all returns all results (stats-jobs.test.ts)
- [x] Logs API invalid cursor — malformed cursor parameter returns 400 with error message (logs-api.test.ts)
