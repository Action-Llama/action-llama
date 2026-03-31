---
name: new-agent
description: Create a new Action Llama agent with SKILL.md and config.toml. Use when creating, adding, or scaffolding a new agent.
argument-hint: "<agent-name>"
---

# Create a new agent

Create a new Action Llama agent named `$ARGUMENTS`.

## Steps

1. Ask the user for:
   - **Trigger type**: `schedule` (cron), `webhook`, or both
   - If schedule: a cron expression (e.g. `*/5 * * * *`)
   - If webhook: the provider and event (e.g. `github` / `issues.opened`)
   - **Credentials** needed (e.g. `github_token`, `slack_bot_token`)
   - A one-sentence description of what the agent should do

2. Use `al_agents` to list existing agents and avoid name conflicts.

3. Create `agents/$ARGUMENTS/SKILL.md` with:
   - YAML frontmatter containing portable metadata only: `name`, `description`, optionally `license` and `compatibility`
   - Do NOT include `name` or `model` in the frontmatter — name is derived from the directory, model is inherited from project config
   - A markdown body with clear instructions for the agent
   - For the full SKILL.md specification and available agent commands, read `agent-authoring.md` from the `al` skill

4. Create `agents/$ARGUMENTS/config.toml` with runtime configuration:
   - `models` — list of named model references from project `config.toml`
   - `credentials` — list of credential types the agent needs
   - `schedule` and/or `webhooks` — trigger configuration
   - For the full config.toml reference, read `agent-authoring.md` from the `al` skill

5. Confirm the agent was created and suggest next steps:
   - `al doctor` to verify credentials
   - `/al:run` to test it
