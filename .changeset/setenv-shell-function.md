---
"@action-llama/action-llama": patch
---

Add `setenv NAME value` shell function for persisting environment variables across bash commands. Agents can now use `setenv REPO "owner/repo"` instead of manually writing to `/tmp/env.sh`. The function handles special characters safely via `printf %q` and is available in all execution modes (container, chat, local).
