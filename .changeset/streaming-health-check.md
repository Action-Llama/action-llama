---
"@action-llama/action-llama": patch
---

Improved `al push` health check to handle slow first-time deployments. The health
check now streams live journal output so you can see Docker image build progress,
waits up to 3 minutes (was 12 seconds), and detects service crashes to fail fast
instead of waiting for the full timeout.
