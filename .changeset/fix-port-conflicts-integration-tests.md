---
"@action-llama/action-llama": patch
---

Fixed integration test port conflicts that caused CI failures. Replaced naive random port selection with proper port availability checking using OS-assigned ports. Resolves EADDRINUSE errors when multiple tests run concurrently.