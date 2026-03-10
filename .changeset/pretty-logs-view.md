---
"@action-llama/action-llama": patch
---

`al logs` now defaults to a colorful conversation view that shows assistant text,
bash commands, tool usage, and errors in a readable format. Pass `-r`/`--raw` to
see the original JSON structured logs. Agent text output is now logged per-turn
so it appears in the conversation view.
