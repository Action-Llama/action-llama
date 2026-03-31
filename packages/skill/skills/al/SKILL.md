---
name: al
description: Action Llama reference — agent authoring, CLI operations, and debugging. Loaded automatically when working with Action Llama projects.
user-invocable: false
---

# Action Llama Reference

Action Llama (`al`) is a CLI tool for running LLM agents as scripts, triggered by cron schedules and webhooks.

## When to use this reference

Load the relevant supporting file based on what you need:

- **[agent-authoring.md](agent-authoring.md)** — Creating and configuring agents: SKILL.md format, config.toml fields, credential types, model providers, webhook setup
- **[operations.md](operations.md)** — Running and deploying: CLI commands, project config, scheduler, Docker, VPS/cloud deployment, gateway API, dashboard
- **[debugging.md](debugging.md)** — Diagnosing issues: agent commands, exit codes, runtime context, resource locks, dynamic context, subagent calls, scaling

## Key concepts

- An **agent** is a directory under `agents/<name>/` containing `SKILL.md` (portable instructions) and `config.toml` (runtime config)
- A **skill** is the portable artifact (`SKILL.md` + optional `Dockerfile`) that can be shared and installed
- Config uses a 3-layer merge: `config.toml` (committed) → `.env.toml` (gitignored) → environment file (machine-level)
- Credentials live in `~/.action-llama/credentials/<type>/<instance>/<field>`
- The MCP server (`al mcp serve`) exposes tools: `al_run`, `al_start`, `al_stop`, `al_status`, `al_agents`, `al_logs`, `al_pause`, `al_resume`, `al_kill`
