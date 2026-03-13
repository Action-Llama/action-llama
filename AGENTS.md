# Action Llama Project

This is an Action Llama project. It runs automated development agents triggered by cron schedules or webhooks.

## Project Structure

Each agent is a directory containing:

- `agent-config.toml` — credentials, model, schedule, webhooks, params
- `ACTIONS.md` — the system prompt that defines what the agent does
- `Dockerfile` (optional) — custom Docker image for this specific agent, extending the project base

## Creating an Agent

1. Create a directory for your agent (e.g. `my-agent/`)
2. Add `agent-config.toml` with credentials, model config, and a schedule or webhook trigger
3. Add `ACTIONS.md` with the actions — step-by-step instructions the LLM follows each run
4. If your agents need shared tools beyond the base image (git, curl, openssh-client, node), edit the project `Dockerfile` at the project root. For agent-specific tools, add a `Dockerfile` to that agent's directory — see Container Isolation section below
5. Verify with `npx al stat`
6. Run with `npx al start`

## Credential Reference

Credentials are managed by the user via `al doctor` or `al creds add` and stored in `~/.action-llama/credentials/<type>/<instance>/<field>`. Reference them in `credentials` arrays as `"type:instance"` (e.g. `"github_token:default"`). The `:default` instance suffix can be omitted.

| Type | What it is | Fields | Runtime injection | What it enables |
|------|-----------|--------|-------------------|----------------|
| `anthropic_key` | Anthropic API key or OAuth token | `token` | Read directly by the agent SDK (not an env var) | LLM access (Anthropic models) |
| `openai_key` | OpenAI API key | `token` | Read directly by the agent SDK | LLM access (OpenAI models) |
| `groq_key` | Groq API key | `token` | Read directly by the agent SDK | LLM access (Groq models) |
| `google_key` | Google Gemini API key | `token` | Read directly by the agent SDK | LLM access (Gemini models) |
| `xai_key` | xAI API key | `token` | Read directly by the agent SDK | LLM access (Grok models) |
| `mistral_key` | Mistral API key | `token` | Read directly by the agent SDK | LLM access (Mistral models) |
| `openrouter_key` | OpenRouter API key | `token` | Read directly by the agent SDK | LLM access (OpenRouter multi-provider) |
| `custom_key` | Custom provider API key | `token` | Read directly by the agent SDK | LLM access (custom providers) |
| `github_token` | GitHub PAT (repo + workflow scopes) | `token` | `GITHUB_TOKEN` and `GH_TOKEN` env vars | `gh` CLI, `git` over HTTPS, GitHub API |
| `git_ssh` | SSH private key + git identity | `id_rsa`, `username`, `email` | SSH key mounted as file; `GIT_SSH_COMMAND` configured automatically; `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` set from `username`/`email` | `git clone`/`push` over SSH — **required for pushing to repos** |
| `sentry_token` | Sentry auth token | `token` | `SENTRY_AUTH_TOKEN` env var | Sentry API via `curl` |
| `github_webhook_secret` | Shared HMAC secret | `secret` | Used by gateway only (not injected into agents) | Validates GitHub webhook payloads |
| `sentry_client_secret` | Sentry client secret | `secret` | Used by gateway only (not injected into agents) | Validates Sentry webhook payloads |

**IMPORTANT:** Agents MUST NEVER ask users for credentials directly (API keys, tokens, passwords, etc.). Agents MUST NEVER run `al doctor` or interact with the credential system on behalf of the user. If a credential is missing at runtime, the agent should report the error and stop — the user will run `al doctor` and `al start` themselves.

## Runtime Context

Every agent prompt has these XML blocks injected automatically at runtime:

### `<agent-config>`

JSON object containing the agent's custom `[params]` from `agent-config.toml`. Example:

```json
{"repos":["acme/app"],"triggerLabel":"agent","assignee":"bot-user"}
```

(In this example, `repos` is a custom param defined in `[params]` — not a built-in field.)

### `<credential-context>`

Lists which env vars and tools are available based on the agent's `credentials` array. Includes anti-exfiltration policy. The agent can rely on env vars like `GITHUB_TOKEN`, `GH_TOKEN`, `SENTRY_AUTH_TOKEN` being already set — it does NOT need to set them.

### `<webhook-trigger>` (webhook runs only)

JSON object with the webhook event details. Only present when the agent is triggered by a webhook (not on scheduled runs). Schema:

```json
{
  "source": "github",
  "event": "issues",
  "action": "labeled",
  "repo": "acme/app",
  "number": 42,
  "title": "Add dark mode",
  "body": "Issue description...",
  "url": "https://github.com/acme/app/issues/42",
  "author": "user",
  "assignee": "bot-user",
  "labels": ["agent"],
  "branch": null,
  "comment": null,
  "sender": "user",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### `<agent-trigger>` (agent-triggered runs only)

JSON object with the source agent name and context. Only present when the agent was triggered by another agent via a `[TRIGGER]` signal. Schema:

```json
{
  "source": "dev",
  "context": "I just opened PR #42 on acme/app. Please review it."
}
```

## Signals

Signals are shell commands you run to communicate back to the scheduler. They write signal files to `$AL_SIGNAL_DIR` and optionally POST to the gateway for real-time TUI updates.

### `al-rerun`

Request an immediate rerun to drain remaining backlog.

```
al-rerun
```

Run this when you completed work (processed an issue, merged a PR, etc.) and there may be more items to handle. The scheduler will re-run you immediately, up to `maxReruns` times (default: 10). Without `al-rerun`, the scheduler treats the run as complete and waits for the next scheduled tick. This is the safe default — errors, rate limits, and empty runs won't cause unwanted reruns.

### `al-status "<text>"`

Send a live status update to the TUI and logs.

```
al-status "reviewing PR #42"
al-status "deploying api-prod"
```

Run at natural milestones so the operator can see what you're doing in real time.

### `al-return`

Return a value when you were called by another agent via `al-call`. The calling agent can retrieve this value using `al-check` or `al-wait`.

```
al-return "PR looks good. Approved with minor suggestions on error handling."
```

For multiline results, pipe via stdin:

```
echo "Line 1\nLine 2" | al-return
```

### `al-exit [code]`

Terminate the agent with an exit code, indicating an unrecoverable error.

```
al-exit 10    # Authentication failure
al-exit 11    # Permission denied
al-exit       # Defaults to 15 (unrecoverable error)
```

Standard exit codes: 10 (auth failure), 11 (permission denied), 12 (rate limited), 13 (config error), 14 (dependency error), 15 (unrecoverable), 16 (user abort).

### Agent-to-agent calls

Call other agents and retrieve their results using shell commands (Docker mode only):

- **`al-call <agent>`** — Call another agent. Pass context via stdin. Returns `{"ok":true,"callId":"..."}`.
- **`al-check <callId>`** — Non-blocking status check. Returns `{"status":"pending|running|completed|error", ...}`.
- **`al-wait <callId> [...] [--timeout N]`** — Wait for calls to complete (default timeout: 900s).

```sh
CALL_ID=$(echo "Review PR #42 on acme/app" | al-call reviewer | jq -r .callId)
# ... continue working ...
RESULT=$(al-wait "$CALL_ID")
```

Rules:
- An agent cannot call itself
- If the target is busy, the call is queued until a runner frees up
- Call chains are limited by `maxCallDepth` in `config.toml` (default: 3)

### Combining signals

You can use multiple signal commands in one run. For example, several `al-status` updates as you work, `al-call` to delegate work, and `al-rerun` if there's more work to do.

## Webhook Reference

### How webhooks work

1. Webhook sources are defined in the project's `config.toml` under `[webhooks.<name>]` with a provider type and optional credential
2. The gateway receives an HTTP POST at `/webhooks/github` or `/webhooks/sentry`
3. The payload is validated using the credential's HMAC secret (e.g. `github_webhook_secret` for GitHub)
4. The gateway matches the event against all agents' `[[webhooks]]` entries (AND logic — all specified fields must match; omitted fields are not checked)
5. Matching agents are triggered with a `<webhook-trigger>` block injected into their prompt

### Defining webhook sources in `config.toml`

Webhook sources are defined once at the project level. Each source has a name, provider type, and optional credential instance for HMAC validation:

```toml
[webhooks.my-github]
type = "github"
credential = "MyOrg"          # credential instance name (github_webhook_secret:MyOrg)

[webhooks.my-sentry]
type = "sentry"
credential = "SentryProd"     # credential instance name (sentry_client_secret:SentryProd)

[webhooks.unsigned-github]
type = "github"               # no credential — accepts unsigned webhooks
```

### Agent webhook filters

Agents reference a webhook source by name and add filters:

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Name of a webhook source from `config.toml` (required) |
| `repos` | string[] | Filter to specific repos (owner/repo format) |
| `events` | string[] | Event types: `issues`, `pull_request`, `push`, `issue_comment`, etc. |
| `actions` | string[] | Event actions: `opened`, `labeled`, `closed`, `synchronize`, etc. |
| `labels` | string[] | Only trigger when the issue/PR has ALL of these labels |
| `assignee` | string | Only trigger when assigned to this user |
| `author` | string | Only trigger for events by this author |
| `branches` | string[] | Only trigger for pushes/PRs on these branches |
| `resources` | string[] | Sentry: `error`, `event_alert`, `metric_alert`, `issue`, `comment` |

### GitHub webhook setup

In your GitHub repo settings, add a webhook:
- **Payload URL:** `http://<your-host>:8080/webhooks/github`
- **Content type:** `application/json`
- **Secret:** the same secret stored as the `github_webhook_secret` credential

### TOML syntax for webhooks

Each webhook is a separate `[[webhooks]]` block (double brackets = array of tables). The `source` field references a webhook source defined in `config.toml`:

```toml
# Each [[webhooks]] references a source from config.toml
[[webhooks]]
source = "my-github"
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[[webhooks]]
source = "my-github"
events = ["pull_request"]
# repos = ["my-org/specific-repo"]  # optional — filter to specific repos

[[webhooks]]
source = "my-sentry"
resources = ["error", "event_alert"]
```

## `agent-config.toml` Complete Reference

The config file uses TOML syntax. The agent name is derived from the directory name — do not include it in the config.

### Minimal example (webhook-driven)

```toml
credentials = ["github_token:default", "git_ssh:default"]

[[webhooks]]
source = "my-github"
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[params]
triggerLabel = "agent"
assignee = "your-github-username"
```

The `[model]` section is **optional** — agents inherit the default model from the project's `config.toml`. Only add `[model]` to an agent config if you want to override the default (e.g. use a different model or thinking level for that specific agent).

### Full example (webhooks + params + model override + optional schedule)

```toml
credentials = ["github_token:default", "git_ssh:default", "sentry_token:default"]
# schedule = "*/5 * * * *"  # Optional: for scheduled polling in addition to webhooks

# Optional: override the project default model for this agent
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[[webhooks]]
source = "my-github"
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[[webhooks]]
source = "my-sentry"
resources = ["error", "event_alert"]

[params]
triggerLabel = "agent"
assignee = "bot-user"
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
# repos = ["fallback/repo"]  # Optional: only needed if using schedule without webhook repo context
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentials` | string[] | Yes | Credential refs as `"type:instance"` (see Credential Reference above) |
| `scale` | number | No | Number of concurrent runners (default: 1). Set to `0` to disable the agent |
| `schedule` | string | No* | Cron expression (e.g. "*/5 * * * *") |
| `model` | table | No | LLM model config — omit to inherit from project `config.toml` |
| `model.provider` | string | Yes* | "anthropic", "openai", "groq", "google", "xai", "mistral", "openrouter", or "custom" |
| `model.model` | string | Yes* | Model ID (e.g. "claude-sonnet-4-20250514") |
| `model.thinkingLevel` | string | No | off \| minimal \| low \| medium \| high \| xhigh (only relevant for models with reasoning support, e.g. Claude Sonnet/Opus; omit for other models) |
| `model.authType` | string | Yes* | api_key \| oauth_token \| pi_auth |
| `webhooks[].source` | string | Yes | Name of a webhook source from `config.toml` |
| `webhooks[].repos` | string[] | No | Filter to specific repos |
| `webhooks[].events` | string[] | No | GitHub event types: issues, pull_request, push |
| `webhooks[].actions` | string[] | No | GitHub actions: opened, labeled, closed |
| `webhooks[].labels` | string[] | No | Only trigger for issues/PRs with these labels |
| `webhooks[].resources` | string[] | No | Sentry resources: error, event_alert, metric_alert, issue, comment |
| `params.*` | any | No | Custom key-value pairs injected into the prompt |

*At least one of `schedule` or `webhooks` is required. *Required within `[model]` if the agent defines its own model block.

### TOML syntax reminders

- Strings: `key = "value"`
- Arrays: `key = ["a", "b"]`
- Tables (objects): `[tableName]` on its own line, followed by key-value pairs
- Array of tables: `[[arrayName]]` on its own line — each block is one entry in the array
- Comments: `# comment`

## Example Agent

**Agent actions must be detailed and prescriptive with step-by-step commands. Copy this example and customize rather than writing from scratch.**

The following is a complete, working ACTIONS.md for a developer agent. Use it as a template for all new agents:

```markdown
# Developer Agent

You are a developer agent. Your job is to pick up GitHub issues and implement the requested changes.

Your configuration is in the \`<agent-config>\` block at the start of your prompt.
Use those values for triggerLabel and assignee.

\`GITHUB_TOKEN\` is already set in your environment. Use \`gh\` CLI and \`git\` directly.
(Note: \`gh\` is not in the base Docker image — this agent needs a custom Dockerfile that installs it. See Container Isolation section.)

**You MUST complete ALL steps below.** Do not stop after reading the issue — you must implement, commit, push, and open a PR.

## Repository Context

This agent infers the repository from the issue context instead of using hardcoded configuration.

**For webhook triggers:** The repository is extracted from the \`<webhook-trigger>\` block's \`repo\` field.

**For scheduled triggers:** The agent uses the \`repos\` parameter from \`<agent-config>\` as a fallback to check for work across configured repositories.

## Setup — ensure labels exist

Before looking for work, ensure the required labels exist on the target repo. The repo is determined as follows:

- **Webhook mode:** Extract repo from \`<webhook-trigger>\` JSON block
- **Scheduled mode:** Use repos from \`<agent-config>\` params

Run the following (these are idempotent — they succeed silently if the label already exists):

\`\`\`
# For webhook triggers, use the repo from webhook context
# For scheduled triggers, iterate through configured repos
gh label create "<triggerLabel>" --repo <determined-repo> --color 0E8A16 --description "Trigger label for dev agent" --force
gh label create "in-progress" --repo <determined-repo> --color FBCA04 --description "Agent is working on this" --force
gh label create "agent-completed" --repo <determined-repo> --color 1D76DB --description "Agent has opened a PR" --force
\`\`\`

## Finding work

**Webhook trigger:** When you receive a \`<webhook-trigger>\` block, extract the repository from the \`repo\` field and the issue details from the trigger context. Check the issue's labels and assignee against your \`triggerLabel\` and \`assignee\` params. If the issue matches (has your trigger label and is assigned to your assignee), proceed with implementation using the extracted repository. If it does not match, stop.

**Scheduled trigger:** If \`repos\` parameter exists in \`<agent-config>\`, run \`gh issue list --repo <repo> --label <triggerLabel> --assignee <assignee> --state open --json number,title,body,comments,labels --limit 1\` for each configured repo. If no work found in any repo, stop. If you completed work and there may be more issues to process, run \`al-rerun\`.

## Workflow

**Important:** First determine the target repository from the trigger context (webhook \`repo\` field or configured \`repos\` parameter).

1. **Claim the issue** — run \`gh issue edit <number> --repo <determined-repo> --add-label in-progress\` to mark it as claimed.

2. **Clone and branch** — run \`git clone git@github.com:<determined-repo>.git /workspace/repo && cd /workspace/repo && git checkout -b agent/<number>\`.

3. **Understand the issue** — read the title, body, and comments. Note file paths, acceptance criteria, and linked issues.

4. **Read project conventions** — in the repo, read \`ACTIONS.md\`, \`CLAUDE.md\`, \`CONTRIBUTING.md\`, and \`README.md\` if they exist. Follow any conventions found there.

5. **Implement changes** — work in the repo. Make the minimum necessary changes, follow existing patterns, and write or update tests if the project has a test suite.

6. **Validate** — run the project's test suite and linters (e.g., \`npm test\`). Fix failures before proceeding.

7. **Commit** — \`git add -A && git commit -m "fix: <description> (closes #<number>)"\`

8. **Push** — \`git push -u origin agent/<number>\`

9. **Create a PR** — run \`gh pr create --repo <determined-repo> --head agent/<number> --base main --title "<title>" --body "Closes #<number>\n\n<description>"\`.

10. **Comment on the issue** — run \`gh issue comment <number> --repo <determined-repo> --body "PR created: <pr_url>"\`.

11. **Mark done** — run \`gh issue edit <number> --repo <determined-repo> --remove-label in-progress --add-label agent-completed\`.

## Rules

- Work on exactly ONE issue per run
- Never modify files outside the repo directory
- **You MUST complete steps 7-11.** Do not stop early.
- If tests fail after 2 attempts, create the PR anyway with a note about failing tests
- If the issue is unclear, comment asking for clarification and stop
```

## Container Isolation

All agents run in isolated containers with a read-only root filesystem, dropped capabilities, non-root user, and resource limits.

### Base image

The base image (`al-agent:latest`) is built automatically on first run. It includes Node.js, git, curl, openssh-client, and ca-certificates — the minimum needed for any agent.

### Project base image

The project `Dockerfile` at the project root customizes the base image for **all** agents. It is created by `al new` and checked into git. By default it is a bare `FROM al-agent:latest` (no customizations, skipped at build time). Add shared tools here:

```dockerfile
FROM al-agent:latest

RUN apk add --no-cache python3 github-cli
ENV MY_ORG=acme
```

### Custom agent images

If a specific agent needs extra tools beyond the project base, add a `Dockerfile` to that agent's directory:

```dockerfile
FROM al-agent:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*
USER node
```

The build pipeline automatically rewrites the `FROM` line to point at the project base image. Agent images are built automatically on startup. If no per-agent `Dockerfile` is present, the agent uses the project base (or `al-agent:latest` if the project Dockerfile is unmodified).

### Container filesystem

| Path | Mode | Contents |
|------|------|----------|
| `/app` | read-only | Action Llama application + node_modules |
| `/credentials` | read-only | Mounted credential files (`/<type>/<instance>/<field>`) |
| `/workspace` | read-write (tmpfs, 2GB) | Working directory — repos are cloned here |
| `/tmp` | read-write (tmpfs, 512MB) | Temporary files |
| `/home/node` | read-write (tmpfs, 64MB) | User home — `.ssh/` for SSH keys |

### Docker config options

| Key | Default | Description |
|-----|---------|-------------|
| `local.image` | `"al-agent:latest"` | Base Docker image name |
| `local.memory` | `"4g"` | Memory limit per container |
| `local.cpus` | `2` | CPU limit per container |
| `local.timeout` | `3600` | Max container runtime in seconds |

## Running Agents

Start all agents with `al start` (or `npx al start`). This starts the scheduler which runs all discovered agents on their configured schedules/webhooks. There is no per-agent start command — `al start` always starts the entire project.

### Automatic re-runs

When a scheduled agent runs `al-rerun`, the scheduler immediately re-runs it. This continues until the agent completes without `al-rerun` (no more work), hits an error, or reaches the `maxReruns` limit. This way an agent drains its work queue without waiting for the next cron tick.

Set `maxReruns` in `config.toml` to control the limit (default: 10):

```toml
maxReruns = 5
maxCallDepth = 3      # max depth for agent-to-agent call chains (default: 3)
```

Webhook-triggered and agent-triggered runs do not re-run — they respond to a single event.

## Skills Reference

Agents have access to runtime skills — capabilities taught via a preamble before the actions run. Each skill is documented for LLM consumption:

- [Skills Overview](skills/README.md)
- [Credentials](skills/credentials.md) — env vars, tools, and access patterns from mounted credentials
- [Signals](skills/signals.md) — `al-rerun`, `al-status`, `al-return`, `al-exit` signal commands, `al-call` for agent-to-agent calls
- [Resource Locks](skills/resource-locks.md) — `rlock`, `runlock`, `rlock-heartbeat` for parallel coordination
- [Environment](skills/environment.md) — trigger types, context blocks, container filesystem

## Further Documentation

Full documentation is available on GitHub:

- [Creating Agents](https://github.com/Action-Llama/action-llama/blob/main/docs/creating-agents.md)
- [agent-config.toml Reference](https://github.com/Action-Llama/action-llama/blob/main/docs/agent-config-reference.md)
- [Credentials](https://github.com/Action-Llama/action-llama/blob/main/docs/credentials.md)
- [Webhooks](https://github.com/Action-Llama/action-llama/blob/main/docs/webhooks.md)
- [Docker](https://github.com/Action-Llama/action-llama/blob/main/docs/docker.md) — custom Dockerfiles, standalone images, troubleshooting
- [CLI Commands](https://github.com/Action-Llama/action-llama/blob/main/docs/commands.md)
- [Example Agents](https://github.com/Action-Llama/action-llama/blob/main/docs/examples/dev-agent.md) — dev, reviewer, devops
