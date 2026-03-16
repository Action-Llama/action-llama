---
"@action-llama/action-llama": patch
---

Preserve webhook queues on SIGTERM and add `al stop` command. Previously, shutting down
the scheduler (SIGINT/SIGTERM) called `clearAll()` which deleted queued events from the
persistent StateStore, losing pending webhook events during rolling updates. Now the signal
handler only clears in-memory state, preserving persistent queues for the next instance.
The new `al stop` command intentionally clears both in-memory and persistent queues for a
clean shutdown. Closes #95.
