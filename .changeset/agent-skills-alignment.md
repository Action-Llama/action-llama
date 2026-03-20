---
"@action-llama/action-llama": minor
---

Align agent configuration with the Agent Skills specification.

- Replace ACTIONS.md + agent-config.toml with a single SKILL.md file. All agent
  config (credentials, schedule, hooks, params, model) lives in YAML frontmatter.
  The markdown body is the agent's instructions.
- Replace the preflight provider system with simple shell command hooks.
  `hooks.pre` runs before the LLM session, `hooks.post` runs after.
- Add `!` backtick context injection in SKILL.md body — inline shell commands
  whose output is injected into the prompt at startup.
- Rename agent-to-agent call commands: `al-call` → `al-subagent`,
  `al-check` → `al-subagent-check`, `al-wait` → `al-subagent-wait`.
- Add `description` field to agents, surfaced in `al stat`, web dashboard,
  chat, and subagent catalog.
- Align name validation: 64-char limit, reject consecutive hyphens.
