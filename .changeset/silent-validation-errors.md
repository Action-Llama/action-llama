---
"@action-llama/action-llama": patch
---

Fix `al push` silently swallowing validation errors. When `al push` ran `al doctor` internally with `silent: true`, validation error details were suppressed but the summary "N validation error(s) found. See details above." was still thrown — leaving users with no actionable information. Errors are now always printed regardless of silent mode.
