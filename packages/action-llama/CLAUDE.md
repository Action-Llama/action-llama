# @action-llama/action-llama

CLI tool, gateway server, scheduler, and agent runners.

Published to npm as `@action-llama/action-llama`, CLI binary: `al`.

## Build & Test

```bash
# From this directory:
npm run build          # TypeScript build

# From repo root (preferred):
npm run build          # builds shared + action-llama
npm test               # all tests
npm run test:unit      # unit tests only
```

## Source Layout

```
src/
  cli/              # Command definitions (--env flag, env subcommand)
  setup/            # Project scaffolding
  scheduler/        # Scheduler: agent discovery, cron + webhooks
  agents/           # Agent runners (host + Docker), prompt builder
  gateway/          # HTTP server: router, health, shutdown, webhook routes
  docker/           # Container lifecycle, image + network
  cloud/            # Cloud providers: vps/ (Vultr, Hetzner, SSH), cloudflare/
  remote/           # SSH push deploy: ssh/rsync helpers, bootstrap, push orchestration
  webhooks/         # Webhook registry, provider interface
  tui/              # Ink-based terminal UI
  shared/           # Config, credentials, environment, logger, paths, git helpers
```

## Configuration

Config uses a three-layer merge system for portable projects:

1. **`config.toml`** (committed) — portable project settings: `[models.*]`, `[local]`, `[gateway]`, `[webhooks]`, `[telemetry]`
2. **`.env.toml`** (gitignored) — per-project environment binding + config overrides. Has an `environment` field to select a named environment
3. **`~/.action-llama/environments/<name>.toml`** (machine-level) — infrastructure config: `[server]` (SSH push deploy), plus `gateway.url`, `telemetry.endpoint`

Merge order: `config.toml` -> `.env.toml` -> environment file (later values win, deep merge).

`[cloud]` and `[server]` must be in an environment file (Layer 3) — placing `[cloud]` in `config.toml` is an error. `[cloud]` and `[server]` are mutually exclusive within an environment.

Cloud mode is auto-detected from the merged config (presence of `[cloud]` section). Server mode uses `al push` with `[server]`. The `-E`/`--env <name>` flag or `AL_ENV` env var selects an environment explicitly.

Environment types (for `al env init <name> --type <type>`): `server`.

## Stats & Trigger History

The stats store (`src/stats/store.ts`) uses SQLite to record run history, call edges, and webhook receipts.

Key tables:
- **`runs`** — every agent execution, with `webhook_receipt_id` linking webhook-triggered runs back to their receipt
- **`webhook_receipts`** — every incoming webhook (processed and dead-letter), with headers/body for replay
- **`call_edges`** — agent-to-agent call graph

Trigger history is a UNION view across `runs` and dead-letter `webhook_receipts`, exposed via:
- Dashboard: `/dashboard` (compact table) and `/dashboard/triggers` (full paginated page with dead-letter toggle)
- API: `GET /api/stats/triggers` (JSON, paginated)
- Replay: `POST /api/webhooks/:receiptId/replay` (re-dispatches stored payload)

Webhook deduplication uses provider-specific delivery IDs (e.g. `X-GitHub-Delivery`). Retention is configurable via `historyRetentionDays` in `config.toml` (default: 14 days).

## Shared Types

Domain types (`AgentStatus`, `SchedulerInfo`, `LogLine`, `TokenUsage`) are defined in both `@action-llama/shared` (for the web SPA) and locally in this package (`src/tui/status-tracker.ts`, `src/shared/usage.ts`). The local copies are the runtime source of truth for the CLI. The shared package provides the same types for `@action-llama/web` without creating a circular dependency.
