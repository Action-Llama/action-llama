---
"@action-llama/action-llama": patch
---

Added full integration test system with Docker and shell script agents. Test agents use
bash scripts instead of LLMs inside real Docker containers, exercising the complete stack
(image builds, gateway, webhooks, cron, control API, reruns, signals) at zero LLM cost.

Production changes: fixed agent path bug in image builder (was missing `agents/` prefix),
added `test-script.sh` baking into agent images when present, and added a `TestWebhookProvider`
that skips HMAC validation for test webhooks.
