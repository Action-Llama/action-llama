---
"@action-llama/action-llama": patch
---

Fixed container agents failing to read ACTIONS.md via the read tool. The container
working directory was `/tmp` (an empty tmpfs mount), so file reads resolved there
instead of `/app/static` where agent files are baked into the image. Changed cwd
to `/app/static` and updated the prompt to instruct the LLM to write to `/tmp`.
