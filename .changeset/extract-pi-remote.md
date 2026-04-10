---
"@action-llama/action-llama": patch
---

Extract transport layer into `@action-llama/pi-remote` package. This new package provides a Pi extension for remote code execution via Docker containers, SSH hosts, or local OS users. It includes config discovery (`remotes.json`), interactive `/remote` command for session switching, and a programmatic factory for headless scheduler use. The action-llama package now imports transports from pi-remote via re-export shims, with `TransportAgentRunner` importing directly.
