---
"@action-llama/action-llama": patch
---

Fix "Trigger not found" on the trigger detail page for running webhook-triggered instances. The endpoint now falls back to the status tracker when a run hasn't been written to the database yet.
