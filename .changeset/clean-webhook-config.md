---
"@action-llama/action-llama": minor
---

Webhook sources are now defined in the project's `config.toml` under `[webhooks.<name>]` instead of inline in each agent's `agent-config.toml`. Each source specifies a provider `type` and optional `credential` for HMAC validation. Agent webhook triggers now use `source = "<name>"` to reference a top-level webhook definition, replacing the old `type` and `source` (credential instance) fields. This is a breaking change to webhook configuration format.
