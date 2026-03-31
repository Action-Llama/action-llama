# Create a new agent

Create a new Action Llama agent named `$ARGUMENTS`.

## Steps

1. Ask the user for:
   - **Trigger type**: `schedule` (cron), `webhook`, or both
   - If schedule: a cron expression (e.g. `*/5 * * * *`)
   - If webhook: the provider and event (e.g. `github` / `issues.opened`)
   - **Credentials** needed (e.g. `github_token`, `slack_webhook`)
   - A one-sentence description of what the agent should do

2. Use `al_agents` to list existing agents and avoid name conflicts.

3. Create `agents/$ARGUMENTS/SKILL.md` with:
   - YAML frontmatter containing the trigger config and credentials
   - Do NOT include `name` or `model` in the frontmatter — name is derived from the directory, model is inherited from project config
   - A markdown body with clear instructions for the agent
   - Reference AGENTS.md (symlinked at project root) for the full SKILL.md specification

4. Confirm the agent was created and suggest next steps:
   - `al doctor` to verify credentials
   - `/run` to test it
