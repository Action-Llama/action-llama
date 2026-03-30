---
"@action-llama/action-llama": patch
---

Move `setenv` bash function from an inline TypeScript string to a proper shell script (`al-bash-init.sh`). The function now handles multiple name/value pairs (`setenv A 1 B 2`) and tolerates stray `setenv` tokens between pairs — a common LLM mistake that previously wasted several tool calls per run.
