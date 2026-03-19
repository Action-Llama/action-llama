---
"@action-llama/action-llama": patch
---

Fixed scheduler pause not blocking webhook triggers, queued work, and manual triggers. When the scheduler is paused, all trigger sources (webhooks, cron, manual control API, inter-agent calls) now reject incoming work rather than queuing it. Closes #162.
