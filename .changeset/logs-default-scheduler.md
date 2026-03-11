---
"@action-llama/action-llama": patch
---

Make the agent argument optional in `al logs`, defaulting to scheduler logs.
Running `al logs` or `al logs -c` without an agent name now shows scheduler logs
instead of erroring with "missing required argument".
