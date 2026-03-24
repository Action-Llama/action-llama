---
"@action-llama/action-llama": patch
---

Fix nginx config corruption during `al push` when config contains single quotes (e.g. `proxy_set_header Connection ''`). The heredoc uses a quoted delimiter so no shell escaping is needed — the prior escaping mangled the content and caused `nginx -t` to reject it. Also replaced the mock nginx binary in the e2e VPS container with real nginx so `nginx -t` actually validates config syntax.
