---
"@action-llama/action-llama": patch
---

Fixed integration test race conditions on slow CI (GitHub Actions) by replacing
fixed-duration sleeps with polling helpers (`waitForIdle`, `waitForRunning`).
Removes the flaky `waitForSettle` method entirely.
