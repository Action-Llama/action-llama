---
"@action-llama/action-llama": patch
---

Fixed agent Docker builds failing with `COPY static/ /app/static/: not found` when agents
have no extra files. The COPY directive was hardcoded in the thin-agent Dockerfile template
regardless of whether a static/ directory existed, and was also duplicated when extra files
were present.
