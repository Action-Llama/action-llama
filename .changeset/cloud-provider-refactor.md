---
"@action-llama/action-llama": patch
---

Refactored cloud infrastructure behind a `CloudProvider` interface. AWS (ECS) and GCP (Cloud Run)
logic is now organized under `src/cloud/aws/` and `src/cloud/gcp/` respectively, with provider-specific
provisioning, teardown, IAM, and deploy modules. CLI commands are thin wrappers that delegate to the
provider. Added state file persistence for tracking provisioned resources. Split `CloudConfig` into a
discriminated union (`EcsCloudConfig | CloudRunCloudConfig`) with per-provider validation. Moved
credential directory to `~/.action-llama/credentials/`.
