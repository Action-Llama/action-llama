---
"@action-llama/action-llama": patch
---

Fix MaxListenersExceededWarning for AbortSignal during agent execution. The pi library shares AbortSignals across parallel tool/API calls, which accumulated >10 listeners. Patched AbortController at agent entry points to raise the limit to 20.
