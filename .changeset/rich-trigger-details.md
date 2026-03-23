---
"@action-llama/action-llama": patch
---

Instance detail page now shows richer trigger information: agent-triggered runs link to
the parent instance, webhook-triggered runs display the source, event summary, and
delivery ID from the stored receipt, and schedule-triggered runs show "Scheduled".
Falls back to the previous flat-text display when underlying data has been pruned.
