---
"@action-llama/action-llama": minor
---

Replaced `AL_DASHBOARD_SECRET` Basic Auth with a single API key for both CLI and browser access. The key is stored at `~/.action-llama-credentials/gateway_api_key/default/key` and generated automatically by `al doctor` or on first `al start`. Browser sessions use a login page that sets an HttpOnly cookie; CLI commands send a Bearer token. Added dashboard controls: per-agent Run and Enable/Disable buttons, scheduler Pause/Resume, and Logout. Added `al kill`, `al pause`, `al resume` to CLI docs. A deprecation warning is logged if `AL_DASHBOARD_SECRET` is still set.
