---
"@action-llama/action-llama": patch
"@action-llama/skill": patch
---

Fix: Instance logs not showing full history due to backCursor race condition in frontend polling logic. Increased initial log batch size from 100 to 200 to match API default. Added comprehensive test coverage for backward pagination across date boundaries.
