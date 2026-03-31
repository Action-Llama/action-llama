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
