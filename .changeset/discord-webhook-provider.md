---
"@action-llama/action-llama": patch
---

Add Discord as a webhook provider. Supports the Discord Interactions Endpoint (slash commands, message components, modals, autocomplete) with Ed25519 signature verification. Includes a new `discord_bot` credential type (`application_id`, `public_key`, `bot_token`) and filter fields for `guilds`, `channels`, `commands`, and `events`. Closes #359.
