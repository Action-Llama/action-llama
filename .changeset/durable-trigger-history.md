---
"@action-llama/action-llama": patch
---

Add durable trigger history with webhook receipts. Every incoming webhook is now recorded in a `webhook_receipts` table with headers and body (up to 256 KB) for forensics and replay. Dead-letter webhooks (failed validation, no matching agent, parse errors) are tracked separately.

**New features:**
- Webhook receipt recording with deduplification via provider delivery IDs (e.g. `X-GitHub-Delivery`)
- Unified trigger history view combining runs and dead-letter webhooks, available on the dashboard and via `GET /api/stats/triggers`
- Full trigger history page at `/dashboard/triggers` with pagination and dead-letter toggle
- Webhook replay endpoint: `POST /api/webhooks/:receiptId/replay` re-dispatches stored payloads
- Configurable retention via `historyRetentionDays` in `config.toml` (default: 14 days, previously hardcoded to 90)

**New config field:**
- `historyRetentionDays` (integer, optional) — controls how long runs, call edges, and webhook receipts are kept
