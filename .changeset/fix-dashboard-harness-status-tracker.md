---
"@action-llama/action-llama": patch
---

Fix dashboard integration tests by creating StatusTracker in harness when webUI is enabled

The integration harness now creates a StatusTracker instance when `start({ webUI: true })` is called, ensuring dashboard API routes (/api/dashboard/*) are properly registered by the gateway. The three dashboard integration test files have been updated to pass `{ webUI: true }` to `harness.start()`.
