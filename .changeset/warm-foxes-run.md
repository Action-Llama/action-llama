---
"@action-llama/action-llama": patch
---

Add optional prompt to `al run` for directed one-shot agent runs. Users can now pass a specific task when triggering an agent manually via `al run <agent> "review PR #42"`, through the control API (`POST /control/trigger/:name` with `{ prompt }` body), or via the web dashboard's new Run modal. When no prompt is given, behavior is unchanged. Also fixes manual triggers to use the correct manual prompt suffix instead of the scheduled prompt.
