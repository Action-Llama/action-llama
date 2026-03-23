---
"@action-llama/action-llama": patch
---

Fix dashboard button states: Kill button is now disabled when no instances are running, Run button is disabled when the agent is disabled, and disabled agent rows are visually dimmed. Also fix the double-count bug where clicking Run on a scale>1 agent showed "running 2/2" instead of "running 1/2". Add comprehensive Playwright e2e tests for the dashboard UI.
