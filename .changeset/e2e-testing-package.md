---
"@action-llama/action-llama": minor
---

Add comprehensive end-to-end testing package that validates complete user workflows. The new e2e package tests CLI interactions, web UI flows, and VPS deployment scenarios using containerized environments that closely mirror production setups. Tests run in GitHub Actions but are excluded from local npm test commands to avoid accidental execution.