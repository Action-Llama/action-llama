---
"@action-llama/action-llama": patch
"@action-llama/frontend": patch
---

Unify webhook display: use provider-colored TriggerBadge everywhere

- Fix webhook trigger source to store provider name (e.g. "github") instead of event type (e.g. "issues") in scheduler, watcher, and execution
- Fix pending queue item source access in stats route (ctx.context?.source)
- Add getWebhookSourcesBatch() to StatsStore for enriching historical webhook rows
- Add "manual" and "agent" color variants to TriggerBadge
- Refactor ActivityTable to use TriggerBadge (source-colored) instead of TriggerTypeBadge, shared across Activity page and agent detail page
