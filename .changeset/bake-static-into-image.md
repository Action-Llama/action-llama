---
"@action-llama/action-llama": patch
---

Bake agent config, PLAYBOOK.md, and prompt skeleton into Docker images at build time instead of passing them as Lambda environment variables at runtime. This fixes AWS Lambda's 4KB environment variable size limit being exceeded when agents have large playbooks or configurations. The container entry point reads from baked-in files at `/app/static/` and falls back to environment variables for backwards compatibility with older images.
