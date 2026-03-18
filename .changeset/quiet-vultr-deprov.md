---
"@action-llama/action-llama": patch
---

`al env deprov` no longer prompts for confirmation before deleting a Vultr instance.
Since the environment is being deleted anyway, the extra prompt was unnecessary friction.
