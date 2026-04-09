---
"@action-llama/action-llama": patch
---

Remove duplicate command display in tool result log lines. The tool call line already shows the command, so repeating it in the result line was redundant. Applies to both CLI (`al logs`) and the web dashboard.
