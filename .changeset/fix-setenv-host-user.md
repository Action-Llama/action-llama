---
"@action-llama/action-llama": patch
---

Fix setenv command for host-user runtime: scope env file per agent instance to prevent cross-instance conflicts, and add confirmation output so agents get feedback when setenv succeeds or fails.
