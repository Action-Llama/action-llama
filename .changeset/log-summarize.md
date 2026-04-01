---
"@action-llama/action-llama": minor
---

Add log summarization API endpoint and frontend button. POST `/api/logs/agents/:name/:instanceId/summarize` feeds the last 500 log lines to the agent's first configured model and returns a 2-4 sentence summary. Summaries for completed runs are cached in memory to avoid redundant LLM calls. The instance logs page gains a "Summarize" button that shows the summary as an overlay on the log viewer.
