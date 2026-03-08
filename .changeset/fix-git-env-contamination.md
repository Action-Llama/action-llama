---
"@action-llama/action-llama": patch
---

Fixed a bug where git identity env vars (GIT_AUTHOR_NAME, etc.) set by one agent in host mode
could contaminate other concurrently running agents. The env vars are now saved before each run
and restored afterward.
