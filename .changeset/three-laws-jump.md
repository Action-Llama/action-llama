---
"@action-llama/action-llama": patch
---

Fix Claude CLI harness launches to include `--verbose` when using `--output-format stream-json`, restoring Claude-backed agent runs in dev containers and covering the CLI invocation with a dedicated harness test.
