---
"@action-llama/action-llama": patch
---

Refactored codebase for improved maintainability and testability. Added typed error
classes (ConfigError, CredentialError, CloudProviderError, AgentError) with a unified
CLI error handler (withCommand). Extracted shared HMAC webhook validation, split
oversized modules (doctor.ts, cloud-setup.ts, scheduler/index.ts) into focused files,
and added test helper factories. Removed dead code from scheduler directory. No
user-facing behavior changes.
