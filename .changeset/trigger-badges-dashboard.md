---
"@action-llama/action-llama": patch
---

Add compact trigger badges to the agent dashboard. Each agent row now shows small, colored labels under the agent name indicating its configured triggers (e.g. "schedule", "github issues created"). Labels are computed from agent config and streamed via SSE. Closes #441.
