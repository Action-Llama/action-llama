---
"@action-llama/action-llama": minor
---

Add Google Cloud Run Jobs as a first-class agent execution runtime.

Agents can now run as ephemeral Cloud Run Jobs while the scheduler continues to run on a local machine or VPS. Key features:

- **`CloudRunRuntime`** — implements `Runtime` and `ContainerRuntime`, launching agents as Cloud Run Jobs
- **Secret Manager credentials** — each credential field is staged as an ephemeral Secret Manager secret, mounted at `/credentials/<type>/<instance>/<field>` (identical layout to Docker volume mounts)
- **Artifact Registry** — agent images are pushed to Google Artifact Registry with automatic pruning of old tags (keeps 3 most recent)
- **Cloud Logging** — agent logs are streamed via Cloud Logging API (3s polling)
- **Orphan recovery** — `listRunningAgents()` discovers active Cloud Run Jobs; orphaned jobs are killed on scheduler restart
- **`gcp_service_account` credential** — new built-in credential type for GCP service account JSON keys
- **`CloudRunConfig` config type** — new `[cloud] provider = "cloud-run"` environment file config
- **`cloudRunDockerExtension`** — registers the new runtime as an extension
- **Docs** — new guide at `guides/cloud-run-runtime.mdx` and reference updates
