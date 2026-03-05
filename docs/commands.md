# CLI Commands

## `al new <name>`

Creates a new Action Llama project. Runs interactive setup to configure credentials and LLM defaults.

```bash
npx @action-llama/action-llama new my-project
```

Creates:
- `my-project/package.json` — with `@action-llama/action-llama` dependency
- `my-project/.gitignore`
- `my-project/.workspace/` — runtime state directory
- Credential files in `~/.action-llama-credentials/`

After setup, create agents by following [Creating Agents](creating-agents.md).

## `al start`

Starts the scheduler. Runs all agents on their configured schedules and listens for webhooks.

```bash
al start -p .
al start -p ./my-project
al start -p . --dangerous-no-docker   # Skip Docker isolation (dev only)
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `--dangerous-no-docker` | Disable Docker container isolation |

## `al status`

Shows status of all discovered agents in the project.

```bash
al status -p .
```

Displays each agent's schedule, repos, credentials, and webhook configuration.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al setup`

Checks all agent credentials and interactively prompts for any that are missing. Discovers agents in the project, collects their credential requirements (plus any webhook secret credentials from `config.json`), and ensures each one exists on disk.

```bash
al setup -p .
al setup -p ./my-project
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al logs <agent>`

View log files for a specific agent.

```bash
al logs dev -p .
al logs dev -n 100          # Show last 100 entries
al logs dev -f              # Follow/tail mode
al logs dev -d 2025-01-15   # Specific date
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-n, --lines <N>` | Number of log entries (default: 50) |
| `-f, --follow` | Tail mode — watch for new entries |
| `-d, --date <YYYY-MM-DD>` | View a specific date's log file |
