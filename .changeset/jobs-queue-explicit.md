---
"@action-llama/action-llama": patch
---

Add explicit Jobs queue to the dashboard. Replaces "Recent Triggers" on agent detail pages with a "Jobs" section showing pending, running, and completed jobs. Adds a new /jobs page with agent filtering and pagination. Adds a trigger detail page at /dashboard/triggers/:instanceId with type-specific info (webhook headers/body, agent caller chain, manual prompt, schedule time). Persists trigger context (prompt for manual triggers, context for agent triggers) in the runs table for traceability. Wires up pending job counts from the work queue to the UI. Closes #408.
