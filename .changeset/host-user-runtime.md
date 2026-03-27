---
"@action-llama/action-llama": patch
---

Add host-user runtime mode for agents that need to run on the host machine instead of inside Docker containers. Configure per-agent with `[runtime] type = "host-user"` in agent config.toml. Agents run under a separate OS user via `sudo -u` for lightweight credential isolation. Includes `al doctor` validation for user/sudoers setup, credential staging to temp directories, and working directory isolation per run.
