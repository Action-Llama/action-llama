---
"@action-llama/action-llama": patch
---

Fix EACCES errors in host-user-runtime tests when /tmp/al-runs is root-owned.

The source code now reads `AL_RUNS_DIR` from the environment (falling back to the existing `/tmp/al-runs` default), and the test suite creates an isolated temp directory per test run and points `AL_RUNS_DIR` at it via `process.env`. This prevents permission errors when `/tmp/al-runs` already exists and is owned by root.
