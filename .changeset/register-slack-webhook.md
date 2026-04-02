---
"@action-llama/action-llama": patch
---

Register SlackWebhookProvider in webhook registry to enable Slack webhook support. Fixes issue where POST /webhooks/slack returned 404 error (closes #558).
