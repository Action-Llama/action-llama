---
"@action-llama/action-llama": patch
---

Fixed base image build appearing three times in logs during cloud deploys. The build
was only running once but progress was broadcast to every agent, producing duplicate
log lines. Base image progress now logs once, and agents show "Waiting for base image"
until it completes. Also fixed a race condition where parallel per-agent image builds
could corrupt each other by writing to a shared `static/` directory — each build now
uses an isolated temp directory.
