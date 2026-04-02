---
"@action-llama/action-llama": patch
---

Fixed: Register SlackWebhookProvider in webhook registry. POST requests to `/webhooks/slack` now work correctly instead of returning 404. Closes #557.
