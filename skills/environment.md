# Skill: Environment

Every run starts with context injected into your prompt. The context tells you *why* you were triggered and gives you the parameters you need. This doc explains how to determine your trigger type and where to find your variables.

## Trigger types

You are triggered in exactly one of four ways. Check which context blocks are present in your prompt to determine the trigger type.

### Scheduled run

**How to detect:** No `<webhook-trigger>` or `<agent-trigger>` block. Your prompt says "You are running on a schedule."

**What to do:** Check for new work proactively. Query APIs, list issues, scan for alerts — whatever your actions define. If you completed work and there may be more, run `al-rerun`.

**Where to get context:**
- `<agent-config>` — your custom params (repos, labels, org names, etc.)
- `<credential-context>` — which env vars and tools are available

### Webhook run

**How to detect:** A `<webhook-trigger>` block is present.

**What to do:** Act on the specific event described in the trigger. You don't need to search for work — the work came to you.

**Where to get context:**
- `<webhook-trigger>` — the event payload:

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Webhook provider (e.g. "github", "sentry") |
| `event` | string | Event type (e.g. "issues", "pull_request", "push") |
| `action` | string? | Event action (e.g. "opened", "labeled", "closed") |
| `repo` | string | Repository in `owner/repo` format |
| `number` | number? | Issue or PR number |
| `title` | string? | Issue or PR title |
| `body` | string? | Issue or PR body |
| `url` | string? | URL to the issue, PR, or commit |
| `author` | string? | Author of the issue/PR |
| `assignee` | string? | Current assignee |
| `labels` | string[]? | Labels on the issue/PR |
| `branch` | string? | Branch name (for push/PR events) |
| `comment` | string? | Comment body (for comment events) |
| `sender` | string | GitHub user who triggered the event |
| `timestamp` | string | ISO 8601 timestamp |

- `<agent-config>` — your custom params (use to cross-check labels, assignees, etc.)

### Agent-triggered run

**How to detect:** An `<agent-trigger>` block is present.

**What to do:** Act on the request from the source agent. The trigger context tells you what happened and what's expected.

**Where to get context:**
- `<agent-trigger>` — the trigger payload:

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Name of the agent that triggered you |
| `context` | string | Free-form message from the source agent |

- `<agent-config>` — your custom params

### Manual run

**How to detect:** No trigger blocks. Your prompt says "You have been triggered manually."

**What to do:** Same as a scheduled run — check for work proactively.

## The `<agent-config>` block

Always present. Contains the JSON-serialized `[params]` table from your `agent-config.toml`. This is where agent authors put repo names, label names, org identifiers, and anything else the agent needs.

Example:
```json
{"repos":["acme/app"],"triggerLabel":"agent","assignee":"bot-user"}
```

Your actions should reference these values by name rather than hardcoding them.

## The `<credential-context>` block

Always present. Lists the environment variables and tools available to you based on your mounted credentials. See [Credentials](credentials.md) for the full reference.

## Container filesystem

| Path | Mode | Contents |
|------|------|----------|
| `/app` | read-only | Action Llama application + node_modules |
| `/credentials` | read-only | Mounted credential files |
| `/workspace` | read-write (tmpfs, 2 GB) | Working directory — clone repos here |
| `/tmp` | read-write (tmpfs, 512 MB) | Temporary files |
| `/home/node` | read-write (tmpfs, 64 MB) | User home — `.ssh/` for SSH keys |

## Internal env vars

These are set automatically and used by the `rlock`/`runlock`/`al-shutdown` commands internally. You don't need to reference them directly:

| Var | Purpose |
|-----|---------|
| `GATEWAY_URL` | Base URL of the scheduler's HTTP gateway |
| `SHUTDOWN_SECRET` | Per-run secret for authenticated API calls |
