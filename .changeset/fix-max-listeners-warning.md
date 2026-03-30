---
"@action-llama/action-llama": patch
---

Fix MaxListenersExceededWarning during `al start` by raising the process event listener limit. The scheduler, TUI, gateway, and telemetry collectively register more than Node's default 10 cleanup handlers per signal.
