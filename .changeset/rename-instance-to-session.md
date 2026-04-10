---
"@action-llama/action-llama": patch
---

Rename "instance" to "session" across the execution layer to align with Pi nomenclature. Agent runs are now identified by `sessionId` instead of `instanceId`. Includes DB migration to rename columns (`instance_id` → `session_id`, `caller_instance` → `caller_session`, `target_instance` → `target_session`) and updated API routes (`/control/sessions`, `/control/kill/:sessionId`, etc.). Credential system "instance" (meaning credential profile/scope) is unchanged.
