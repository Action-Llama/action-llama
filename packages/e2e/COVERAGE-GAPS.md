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
- [x] Chat session list endpoint — GET /api/chat/sessions returns active sessions, new session appears in list (chat.test.ts)
- [x] Chat session limit enforcement — POST /api/chat/sessions returns 429 when maxChatSessions limit is reached (chat.test.ts)
- [x] run:start event correlation — verify run:start event's instanceId matches trigger API response instanceId, trigger field is 'manual' (scheduler.test.ts)
- [x] run:end event exitCode — verify run:end event includes exitCode matching the container's exit code for error exits (signals.test.ts)
- [x] Dashboard instance detail API — GET /api/dashboard/agents/:name/instances/:id returns run details, null for unknown instanceId; GET /api/dashboard/triggers/:instanceId returns trigger info for manual runs, 404 for unknown instanceId (dashboard-instance-api.test.ts)
- [x] Scheduler rejects agent with no schedule and no webhooks — validateAgentConfig() throws ConfigError on startup (scheduler-validation.test.ts)
- [x] Logs API timestamp filtering — ?after=<future> returns empty, ?before=0 returns empty (logs-api.test.ts)
- [x] Stats/activity advanced filters — ?triggerType= filter on activity (not tested on triggers only), ?since=<future> returns empty, comma-separated ?status=completed,errored, ?status=all vs single filter, stats/jobs pending+totalPending response fields (stats-activity-filters.test.ts)
- [x] Webhook endpoint edge cases — POST to unknown source returns 404, Content-Length > 10 MB returns 413, valid payload accepted, invalid JSON body handled gracefully (webhook-edge-cases.test.ts)
- [x] Stats/jobs pagination and filtering — ?limit+?offset pagination, ?since=<future> returns empty, empty store returns valid shape, dead-letter entries excluded from jobs (stats-jobs-pagination.test.ts)
- [x] Scheduler logs grep and lines parameters — ?grep regex filtering on /api/logs/scheduler, invalid ?grep returns 400, ?lines limits count, default response shape always present (logs-scheduler-filters.test.ts)
- [x] /locks/list endpoint — container acquires lock then list shows it, release empties list, missing secret returns 400, invalid secret returns 403 (locks-list-endpoint.test.ts)
- [x] Signal route error paths — POST /signals/rerun|status|trigger|return: missing secret → 400, invalid secret → 403, invalid JSON body → 400 (signals-error-paths.test.ts)
- [x] /calls route error paths — POST /calls: missing secret → 400, invalid secret → 403, missing targetAgent → 400, invalid JSON → 400; GET /calls/:callId: missing secret → 400, invalid secret → 403 (calls-error-paths.test.ts)
- [x] al-subagent-wait returnValue from al-return — caller reads returnValue field from wait result when callee uses al-return, returnValue is null when callee exits without al-return (subagent-return-value.test.ts)
- [x] /calls route additional validation paths — POST /calls: missing targetAgent → 400, missing context → 400; GET /calls/:callId with valid secret but unknown callId → 404 "call not found" (calls-error-paths.test.ts)
- [x] Lock route HTTP error paths — POST /locks/release for non-existent lock → 404, POST /locks/heartbeat for non-existent lock → 404, invalid JSON body → 400 for acquire/release/heartbeat (lock-route-errors.test.ts)
- [x] Signal route additional validation paths — POST /signals/trigger: present secret + missing targetAgent → 400, present secret+targetAgent + missing context → 400; POST /signals/return: present secret + missing value → 400 (signals-error-paths.test.ts)
- [x] Control kill-agent 404 and stats run null — POST /control/agents/:name/kill for nonexistent agent → 404; GET /api/stats/agents/:name/runs/:instanceId for unknown instanceId → { run: null } 200 (control.test.ts, stats-jobs.test.ts)
- [x] Dashboard API for agent-triggered runs — parentEdge and callerAgent/callDepth fields populated when callee was triggered via al-subagent; stats/store queryCallEdgeByTargetInstance exercised (dashboard-agent-trigger-api.test.ts)
- [x] Dashboard API for webhook-triggered runs — webhookReceipt in instance detail and webhook field in trigger detail populated for webhook-triggered runs (dashboard-webhook-trigger-api.test.ts)
- [x] Activity endpoint triggerSource from webhook — webhook-triggered activity row has triggerSource populated via stats/store getWebhookSourcesBatch batch lookup (stats-activity-filters.test.ts)
- [x] Stats for agent-triggered runs — /api/stats/activity?triggerType=agent returns callee runs with triggerSource=caller name; /api/stats/triggers?triggerType=agent filters correctly (stats-agent-trigger.test.ts)
- [x] Per-instance logs ?grep parameter — invalid grep returns 400, valid grep filters entries for a specific instanceId (logs-per-instance.test.ts)
- [x] /shutdown route error paths — invalid JSON → 400, missing secret → 400, invalid secret → 403 (shutdown-error-paths.test.ts)
- [x] Webhook form-urlencoded missing payload field — POST with application/x-www-form-urlencoded and no payload field returns 400 (webhook-edge-cases.test.ts)
- [x] Lock route missing field errors — POST /locks/acquire: missing secret → 400, missing resourceKey → 400; POST /locks/release: missing secret → 400; POST /locks/heartbeat: missing secret → 400 (lock-route-errors.test.ts)
- [x] Scheduler validation scale=0 bypass — agent with scale=0 and no schedule/webhooks does not trigger ConfigError; validateAgentConfig scale=0 early return (scheduler-validation.test.ts)
- [x] Hot-reload schedule change — modify schedule in config.toml at runtime; verify rebuildCronJobs stops old cron and creates new one; agent remains functional via manual trigger; removing schedule while keeping webhook works; adding schedule to webhook-only agent works (hot-reload-schedule-change.test.ts)
- [x] Per-agent work queue cap (maxWorkQueueSize) — set maxWorkQueueSize=1 on a slow agent (scale=1), send 3 triggers, verify trigger #2 is dropped when queue is full and only 2 runs complete; covers SqliteWorkQueue overflow, dispatchOrQueue all-busy path, drainQueues after completion (work-queue-cap.test.ts)
- [x] Global defaultAgentScale config — agents without explicit scale inherit defaultAgentScale; agents with explicit scale override it; runner pool size matches configured default; parallel execution works at default scale (default-agent-scale.test.ts)
- [x] historyRetentionDays prunes stats on restart — scheduler started, agent run recorded; restart with historyRetentionDays=0 prunes all runs; stats API returns total:0 after restart (history-retention.test.ts)
- [x] Global local.timeout fallback — no per-agent timeout; global local.timeout=8s kills agent sleeping 30s (result=error); per-agent timeout=8s overrides global local.timeout=120s (global-timeout.test.ts)
- [x] .env.toml overrides config.toml — defaultAgentScale in .env.toml overrides config.toml value; workQueueSize in .env.toml enforces global queue cap via .env.toml layering (env-toml-override.test.ts)
- [x] Hot-reload maxWorkQueueSize change — hot-reload config.toml adds maxWorkQueueSize=1; subsequent triggers respect the new cap (trigger #2 dropped); 3 total runs verify initial + 2 post-reload (hot-reload-queue-cap.test.ts)
- [x] Deprecated config aliases — webhookQueueSize=1 enforces global work queue cap (same as workQueueSize=1); covers scheduler/persistence.ts fallback chain (deprecated-config-aliases.test.ts)
- [x] Webhook source validation on startup — agent referencing undefined webhook source causes startup failure; properly declared source allows normal startup and manual trigger (webhook-source-validation.test.ts)
- [x] Trigger scale=0 agent returns 409 — dispatchOrQueue pool.size===0 rejection path; agent exists but has no runners; 409 vs 404 distinction; active agent still works alongside (control.test.ts)
- [x] al-subagent calls nonexistent agent → 409 (target not found) — call-dispatcher agentConfigs.find() fails; call event emitted with ok:false; caller exits 0 after handling (triggers.test.ts)
- [x] Twitter CRC challenge GET endpoint — success path returns sha256 HMAC response_token with configured consumer_secret; missing crc_token returns 400 (twitter-webhook.test.ts)
- [x] Lock release by wrong instance returns 409 — lock-store.ts release() existing.holder !== holder; route maps non-"lock not found" reason to 409 (lock-route-errors.test.ts)
- [x] Auth middleware browser redirect — Accept: text/html on protected route → 302 to /login; API Accept → 401 JSON; two branches in control/auth.ts (gateway-auth-api.test.ts)
- [x] Stats/triggers triggerType=schedule filter — cron-fired run recorded with triggerType='schedule'; ?triggerType=schedule filter returns only scheduled runs; ?triggerType=manual returns 0 for schedule-only agent (stats.test.ts)
- [x] Orphan container recovery on scheduler restart — simulate scheduler crash (shutdownNoKill) while agent is running; verify re-adoption on restart and run completes; verify stale registry cleanup when containers already exited (orphan-recovery.test.ts)
- [x] SKILL.md context injection — successful !`command` side-effects visible to test-script; failed command substitutes [Error: ...] placeholder without aborting the run; no-op when no injection tokens present (context-injection.test.ts)
- [x] Chat WebSocket endpoints — browser WS 404/401 rejection paths; container WS 404/4003/auth_ok paths; message bridging browser→container; container disconnect notifies browser (chat-ws.test.ts)
- [x] Log summary API — POST /api/logs/agents/:name/:instanceId/summarize: 400 for invalid name/id; 200 "No log entries found" when no log file or unknown instanceId; 500 when LLM fails with fake API key (log-summary-api.test.ts)
- [x] Chat WebSocket message validation — invalid type, invalid JSON, user_message missing text, oversized message (>64KB), valid message when container not connected (chat-ws-validation.test.ts)
- [x] al-subagent call queued when target runner is busy — two callers simultaneously call scale=1 callee; one dispatches immediately, one queues; both complete successfully via drainQueues after first run ends (subagent-queue.test.ts)
- [x] Hot-reload invalid config after change — writing invalid config.toml (no schedule/webhooks) during hot-reload triggers validateAgentConfig error; scheduler survives without crashing; health endpoint still returns ok (hot-reload-invalid-config.test.ts)
- [x] Hot-reload new agent with invalid config — adding new agent directory with no schedule/webhooks; handleNewAgent error branch; scheduler stays healthy; invalid agent not triggerable; original agent unaffected (hot-reload-new-invalid-agent.test.ts)
- [x] POST /control/stop graceful shutdown — endpoint returns {success:true} before async scheduler shutdown; gateway becomes unreachable after stop (control-stop.test.ts)
- [x] Agent logs cursor-based pagination — initial request returns cursor; subsequent request with cursor exercises readEntriesForward(); invalid cursor returns 400; per-instance logs also support cursor pagination (logs-agent-cursor.test.ts)
- [x] git_ssh credential setup — SSH key written to /tmp/.ssh/id_rsa, GIT_SSH_COMMAND configured, GIT_AUTHOR_NAME/EMAIL set from username/email fields; identity-only path (no id_rsa) sets only git identity; agent without git_ssh has no identity vars (git-ssh-credential.test.ts)
- [x] github_token credential env injection — GITHUB_TOKEN and GH_TOKEN alias set from credential; GIT_TERMINAL_PROMPT=0, GIT_CONFIG_COUNT/KEY/VALUE for HTTPS credential helper configured when GITHUB_TOKEN is present; agent without github_token has no GITHUB_TOKEN (github-token-credential.test.ts)
- [x] Missing credential startup rejection — scheduler fails with CredentialError when required credential absent from store; requireCredentialRef() path; positive case (all credentials present) passes (missing-credential.test.ts)
- [x] Undefined model reference startup rejection — scheduler fails with ConfigError when agent references model name absent from global [models] config; loadAgentConfig() model resolution error path; positive case with valid reference passes (missing-model-reference.test.ts)
- [x] No agents found startup rejection — scheduler fails with ConfigError when project has no agent directories; validateAndDiscover() agentNames.length===0 branch; discoverAgents() returns empty array (no-agents-found.test.ts)
- [x] Malformed agent config.toml rejection — scheduler fails with ConfigError when agent config.toml has invalid TOML syntax; parseTOML() throws → ConfigError with file path and parse error details (malformed-config-toml.test.ts)
- [x] Agent directory without SKILL.md ignored — discoverAgents() only discovers directories containing SKILL.md; a dir with only config.toml is silently skipped; valid sibling agent unaffected (missing-skill-md.test.ts)
- [x] Malformed global config.toml rejection — scheduler fails with ConfigError when project config.toml has invalid TOML syntax; loadGlobalConfig() parseTOML() catch → ConfigError with file path (malformed-global-config.test.ts)
- [x] Startup failures without Docker — no-agents/no-triggers/pi_auth/missing-credential startup rejections tested unconditionally (no skipIf guard); exercises real FilesystemBackend credential lookup; Phase 1 failures confirmed before any Docker dependency (startup-failures.test.ts)
- [x] Startup config errors without Docker — undefined model reference (loadAgentConfig model resolution), malformed agent config.toml (parseTOML throws), and undefined webhook source (resolveWebhookSource) all fail at Phase 1 before Docker; tested unconditionally (startup-config-errors.test.ts)
- [x] .env.toml error paths without Docker — malformed .env.toml syntax (loadEnvToml ConfigError) and reference to non-existent named environment (loadEnvironmentConfig ConfigError) both fail before startScheduler; tested unconditionally (startup-env-toml-errors.test.ts)
- [x] SKILL.md parse errors without Docker — malformed YAML frontmatter in SKILL.md causes ConfigError in loadAgentConfig() via parseFrontmatter(); well-formed SKILL.md with extra fields loads successfully; tested unconditionally (startup-skill-md-errors.test.ts)
- [x] Multi-agent validation errors without Docker — valid+invalid agent combo: validateAgentConfig on all agents; multi-agent missing-credential check; manually added agent directory discovered by discoverAgents; tested unconditionally (startup-multi-agent-errors.test.ts)
- [x] Global config defaultAgentScale validation without Docker — negative integer and fractional values both trigger ConfigError from loadGlobalConfig(); zero is valid (non-negative integer); errors occur before startScheduler(); tested unconditionally (startup-global-config-validation.test.ts)
- [x] Agent name validation without Docker — uppercase name, reserved name 'default', and name longer than 64 chars all fail validateAgentName() at Phase 1; discoverAgents() finds the directory regardless of name validity; tested unconditionally (startup-agent-name-validation.test.ts)
- [x] Model configuration validation without Docker — no models field, empty models array, and global config with no [models] table all fail loadAgentConfig() at Phase 1; tested unconditionally (startup-models-validation.test.ts)
- [x] Phase 2 persistence layer runs before Docker without Docker — SQLite database created at .al/action-llama.db before Phase 4 fails; Phase 1 validation confirmed to succeed for valid config before Phase 4 failure; tested unconditionally (startup-phase2-persistence.test.ts)
- [x] Phase 3 gateway starts before Docker check without Docker — setupGateway() starts HTTP server before Phase 4; /health endpoint responds with {status:"ok"} after Phase-4 failure; gateway startup confirmed Docker-independent; tested unconditionally (startup-phase3-gateway.test.ts)

- [x] Config utility functions without Docker — loadSharedFiles() empty/missing/nested/hidden-files; discoverAgents() missing-dir/no-SKILL.md/sorted/hidden-skipped/non-dir; validateAgentName() edge cases (trailing hyphen, leading hyphen, consecutive hyphens, underscore, empty, 64-char boundary); getAgentScale() default/custom/zero; getProjectScale() default/custom — all tested without starting scheduler (config-utils.test.ts)

- [x] Config file operation functions without Docker — loadAgentBody() missing/frontmatter+body/no-frontmatter/empty-body; loadAgentRuntimeConfig() missing/valid/malformed-TOML; updateAgentRuntimeField() creates-new/updates-existing/adds-field/string-field; updateProjectScale() writes-to-existing/creates-new/overwrites — all tested without scheduler (config-file-ops.test.ts)

- [x] Global config loading without Docker — loadProjectConfig() returns {} for missing file, parses valid TOML, throws for malformed TOML, does not apply .env.toml; loadGlobalConfig() returns default telemetry, preserves custom telemetry, applies .env.toml deep-merge (gateway port), sets projectName from .env.toml, throws for negative/fractional defaultAgentScale, accepts 0, throws for malformed .env.toml — tested without scheduler (global-config-loading.test.ts)

- [x] StatusTracker and buildTriggerLabels without Docker — buildTriggerLabels() no-triggers/schedule-only/multi-event/single-event/single-event+action/multi-action/multi-webhook/both; StatusTracker register/unregister/enable/disable/isAgentEnabled/isPaused/setPaused/registerInstance/getInstances/unregisterInstance/invalidation/updateAgentScale/setAgentTriggers — tested in-memory without scheduler (status-tracker.test.ts)

- [x] SchedulerEventBus without Docker — on/emit, multiple events in order, once fires once, off removes listener, removeAllListeners, waitFor resolves, waitFor with predicate, waitFor timeout rejection, collect+stop, collect stops after stop(), independent event types — tested in-memory (scheduler-event-bus.test.ts)

- [x] Prompt builder functions without Docker — makeScheduledPrompt(useBakedImages=true) returns schedule suffix, no agent name; makeManualPrompt(useBakedImages=true) manual vs user-prompt variants, <user-prompt> tags; makeWebhookPrompt(useBakedImages=true) embeds context, <webhook-trigger> tags; makeTriggeredPrompt(useBakedImages=true) includes caller/context, <agent-call> tags — tested without scheduler (prompt-builders.test.ts)

- [x] loadAgentConfig extended behaviors without Docker — defaultAgentScale fallback when no explicit scale; explicit scale overrides defaultAgentScale; scale undefined when neither defines it; timeout/maxWorkQueueSize/hooks/params preserved; description from SKILL.md frontmatter included; throws for unknown model reference; multiple model resolution — tested without scheduler (load-agent-config.test.ts)
