---
"@action-llama/action-llama": patch
---

Added a dedicated "Initializing" TUI phase during Docker image builds. Instead of
showing the full running view while images are still building, `al start` now displays
a focused build progress screen with per-agent spinners and build step details, then
transitions to the normal running TUI once all images are ready.
