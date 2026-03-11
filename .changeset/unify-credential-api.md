---
"@action-llama/action-llama": patch
---

Unified credential handling by migrating all code to use async backend-aware API, eliminating sync filesystem-specific functions. All credential operations (`loadCredentialField`, `writeCredentialField`, `credentialExists`, etc.) are now consistently async and work with both local filesystem and remote backends. This change improves consistency and reduces API surface area, preventing accidental divergence between sync and async credential handling patterns. Closes #55.