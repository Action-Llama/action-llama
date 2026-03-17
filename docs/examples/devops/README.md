# DevOps Agent

A monitoring agent that detects errors from CI/CD failures and Sentry production alerts, then files deduplicated GitHub issues for each unique problem.

## Setup

1. Copy `agent-config.toml` and `ACTIONS.md` into `agents/devops/` in your project
2. Edit `agent-config.toml`:
   - Set `repos` to the repositories to monitor
   - Set `sentryOrg` and `sentryProjects` for Sentry integration (or remove if not using Sentry)
   - Adjust `schedule` as needed (default: every 15 minutes)
3. Run `al doctor` to verify credentials

## How it works

Each run, the agent:

1. Polls for recent CI failures across configured repos
2. Polls Sentry for unresolved errors in the last 24 hours (if configured)
3. Deduplicates against existing `agent-filed` issues to avoid duplicates
4. Files new GitHub issues with appropriate labels (`ci-failure` or `production-error`)

The agent only files issues — it does not attempt to fix errors itself.
