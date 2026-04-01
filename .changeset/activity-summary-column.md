---
"@action-llama/action-llama": patch
---

Add Summary column to Activity table. On desktop, shows an AI-generated summary of each run with generate/regenerate buttons. On mobile, shows a collapsible summary below the trigger badge with a smaller instance ID font. Summaries are now persisted to the SQLite `runs` table so they survive server restarts. Also updates the summary prompt to describe what triggered the run, what resource it operated on, what it did, and any errors. Closes #513.
