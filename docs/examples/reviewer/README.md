# Reviewer Agent

A code review agent that reviews open pull requests, approves good ones, requests changes on problematic ones, and auto-merges approved PRs with passing CI.

## Setup

1. Copy `agent-config.toml` and `ACTIONS.md` into `agents/reviewer/` in your project
2. Edit `agent-config.toml`:
   - Set `repos` to the repositories you want reviewed
   - Adjust `schedule` as needed (default: every 5 minutes)
3. Run `al doctor` to verify credentials

## How it works

Each run, the agent:

1. Lists all open PRs across configured repos
2. Reads the diff for each PR
3. Evaluates correctness, style, tests, security, and performance
4. Submits a review: approve + merge, request changes, or comment (if CI is failing)

The agent reviews **all** open PRs in a single run and never approves a PR with failing CI.
