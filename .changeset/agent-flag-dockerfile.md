---
"@action-llama/action-llama": patch
---

Rename `al add --skill` flag to `--agent`/`-a` to match the agents/ directory convention, and copy Dockerfiles alongside SKILL.md during `al add` and `al update`. When a source repo includes a Dockerfile co-located with the SKILL.md, it is now copied into the agent directory and kept in sync on updates.
