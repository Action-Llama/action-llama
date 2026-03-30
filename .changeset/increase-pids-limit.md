---
"@action-llama/action-llama": patch
---

Increase container PID limit from 256 to 1024 to prevent EAGAIN fork failures in agents that run heavy workloads (npm install, test suites, etc.)
