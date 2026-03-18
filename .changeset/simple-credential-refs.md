---
"@action-llama/action-llama": minor
---

**Breaking:** Credential references now resolve deterministically from the ref string instead of probing the filesystem. `credentials = ["github_token"]` always resolves to `github_token/default/` — it no longer checks for an agent-specific `github_token/<agentName>/` directory. Use explicit colon syntax for named instances: `"git_ssh:botty"`. The cross-agent slash syntax (`"other-agent/github_token"`) has been removed.
