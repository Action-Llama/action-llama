---
"@action-llama/action-llama": patch
---

Added optional `projectName` field to `.env.toml` for human-readable project identification.
When set, the project name appears in the TUI header and in headless log output, making it
easier to identify which project is running. `al new` now scaffolds `.env.toml` with
`projectName` pre-populated from the project name.
