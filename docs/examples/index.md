# Example Agents

Ready-to-use agent configurations. Each directory contains everything you need to add the agent to your project:

- `agent-config.toml` — drop into `agents/<name>/`
- `ACTIONS.md` — the agent's system prompt (also goes in `agents/<name>/`)
- `README.md` — explanation, setup notes, and customization tips

## Agents

| Agent | Description | Trigger |
|-------|-------------|---------|
| [dev](dev/) | Picks up GitHub issues and implements the requested changes — clones, branches, codes, tests, and opens a PR | Webhook (issue labeled) or scheduled |
| [reviewer](reviewer/) | Reviews open pull requests, approves good ones, and requests changes on problematic ones | Scheduled |
| [devops](devops/) | Monitors CI/CD failures and Sentry errors, then files deduplicated GitHub issues | Scheduled |
