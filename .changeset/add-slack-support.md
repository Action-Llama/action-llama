---
"@action-llama/action-llama": patch
---

Add Slack webhook provider and credential support. Agents can now listen for Slack Events API webhooks and interact with Slack via the `SLACK_BOT_TOKEN` environment variable. Includes `slack_bot_token` and `slack_signing_secret` credential types, full signature verification with replay protection, and URL verification challenge handling.
