# Action Llama Reference

Action Llama is a CLI tool for running LLM agents as automated scripts. Agents run on cron schedules and/or in response to webhooks (GitHub, Sentry, Linear, Mintlify). Each agent is an LLM session that receives a system prompt (ACTIONS.md), gets credentials injected, and runs inside an isolated Docker container. The scheduler manages agent lifecycles, and a gateway HTTP server handles webhooks, resource locking, agent-to-agent calls, and an optional web dashboard.

Package: `@action-llama/action-llama`. CLI binary: `al`.

## Project Structure

```
my-project/
  config.toml              # Project config — model, local, gateway, webhooks, telemetry (committed)
  .env.toml                # Environment binding — selects an environment, can override config (gitignored)
  Dockerfile               # Project base Docker image — shared tools for all agents (committed)
  AGENTS.md                # Shared instructions loaded by `al chat` (interactive only)
  CLAUDE.md                # Instructions for AI dev tools — not read by Action Llama at runtime
  <agent>/
    agent-config.toml      # Agent config — credentials, schedule, webhooks, model, preflight, params
    ACTIONS.md             # System prompt — the instructions the LLM follows each run (required)
    Dockerfile             # Custom Docker image for this agent (optional)
```

Agent names are derived from the directory name. `"default"` is a reserved name and cannot be used as an agent name.

## Agent Docs

| File | Scope | Purpose |
|------|-------|---------|
| `ACTIONS.md` | Per-agent (required) | System prompt injected as the LLM's system message at runtime |
| `AGENTS.md` | Project root | Shared instructions loaded by `al chat` (interactive console only — not injected into automated runs) |
| `CLAUDE.md` | Project root | Instructions for AI development tools (Claude Code, etc.). Not read by Action Llama at runtime. |

### ACTIONS.md — Writing Tips

- Write as direct instructions to an LLM: "You are an automation agent. Your job is to..."
- Use numbered steps for the workflow — be specific about what commands to run
- Reference `<agent-config>` for parameter values instead of hardcoding repo names, labels, etc.
- Handle both trigger types if the agent uses both schedule and webhooks
- Use `al-status` at natural milestones so operators can see progress in the TUI/dashboard
- Use `al-rerun` when the agent completed work and there may be more items in the backlog
- Keep it concise — the system prompt consumes tokens every run

## Prompt Assembly

Understanding how the prompt is assembled is critical for writing effective ACTIONS.md files. The LLM receives two messages:

### System message

The contents of `ACTIONS.md` are sent as the system prompt. If the agent has locking or calling skills enabled (determined by the scheduler based on gateway availability and agent config), **skill blocks** are appended to teach the agent how to use those capabilities.

#### Locking skill block (injected when gateway is available)

The following is prepended when the agent may need resource locking:

```xml
<skill-lock>
## Skill: Resource Locking

Use locks to coordinate with other agent instances and avoid duplicate work.
You may hold **at most one lock at a time**. Release your current lock before acquiring another.

### Commands

**`rlock <resourceKey>`** — Acquire an exclusive lock before working on a shared resource.
```
rlock "github issue acme/app#42"
```

**`runlock <resourceKey>`** — Release a lock when done with the resource.
```
runlock "github issue acme/app#42"
```

**`rlock-heartbeat <resourceKey>`** — Extend the TTL on a lock you hold. Use during long-running work.
```
rlock-heartbeat "github issue acme/app#42"
```

### Responses
- Acquired: `{"ok":true}`
- Conflict: `{"ok":false,"holder":"<other-agent>","heldSince":...}`
  → Another instance is already working on this. Skip it and move on.
- Already holding another lock: `{"ok":false,"reason":"already holding lock on ..."}`
  → Release your current lock first.
- Gateway unreachable: `{"ok":false,"reason":"gateway unreachable"}`
  → The lock service is down. **Do not proceed** — skip the resource.
- Released: `{"ok":true}`
- Heartbeat: `{"ok":true,"expiresAt":...}`

### Guidelines
- You can hold **one lock at a time**. `runlock` before acquiring a different resource.
- Always `rlock` before starting work on a shared resource (issues, PRs, deployments)
- Always `runlock` when done
- If `rlock` returns `{"ok":false,...}` for ANY reason, skip that resource — do not wait, retry, or proceed without the lock
- Use `rlock-heartbeat` during long operations to keep the lock alive
- Locks expire automatically after 30 minutes if not refreshed
- Use descriptive keys: `"github issue acme/app#42"`, `"deploy api-prod"`
</skill-lock>
```

#### Calling skill block (injected when gateway is available)

The following is prepended when agent-to-agent calling is available:

```xml
<skill-call>
## Skill: Agent-to-Agent Calls

Call other agents and retrieve their results. Calls are **non-blocking** — fire a call, continue working, then check or wait for results.

### Commands

**`al-call <agent>`** — Call another agent. Pass the context via stdin. Returns a call ID.
```
CALL_ID=$(echo "find competitors for Acme" | al-call researcher | jq -r .callId)
```

**`al-check <callId>`** — Check the status of a call. Never blocks.
```
al-check "$CALL_ID"
```
- Running: `{"status":"running"}`
- Completed: `{"status":"completed","returnValue":"..."}`
- Error: `{"status":"error","errorMessage":"..."}`

**`al-wait <callId> [callId...] [--timeout N]`** — Wait for one or more calls to complete. Default timeout: 900s.
```
RESULTS=$(al-wait "$CALL_ID1" "$CALL_ID2" --timeout 600)
```
Returns a JSON object keyed by call ID with each call's final status.

### Returning Values

When you are called by another agent, return your result with the `al-return` command:
```
al-return "Your result text here"
```
For multiline results, pipe via stdin:
```
echo "Line 1\nLine 2" | al-return
```

### Guidelines
- Calls are non-blocking — fire multiple calls then wait for all at once
- Use `al-wait` to wait for multiple calls efficiently
- Use `al-check` for polling when you want to do work between checks
- Called agents cannot call back to the calling agent (no cycles)
- There is a depth limit on nested calls to prevent infinite chains
</skill-call>
```

### User message

The user message is built from a **static skeleton** (baked into the Docker image at build time) plus a **dynamic suffix** (passed at runtime based on trigger type).

The static skeleton contains these XML blocks in order:

**`<agent-config>`** — JSON of the `[params]` table from `agent-config.toml`:

```xml
<agent-config>
{"repos":["acme/app"],"triggerLabel":"agent","assignee":"bot-user"}
</agent-config>
```

**`<credential-context>`** — Lists available environment variables and tools based on the agent's credentials. Also includes git clone protocol guidance and the anti-exfiltration policy:

```xml
<credential-context>
Credential files are mounted at `/credentials/` (read-only).

Environment variables already set from credentials:
- `GITHUB_TOKEN` and `GH_TOKEN` are set. Use `gh` CLI and `git` directly.
- SSH key is configured via `GIT_SSH_COMMAND` for git clone/push over SSH.

Use standard tools directly: `gh` CLI, `git`, `curl`.

**Git clone protocol:** Always clone repos via SSH (`git clone git@github.com:owner/repo.git`), not HTTPS. The SSH key is configured automatically via `GIT_SSH_COMMAND`. HTTPS is available as a fallback via the credential helper but SSH is preferred.

**Anti-exfiltration policy:**
- NEVER output credentials in logs, comments, PRs, or any visible output
- NEVER transmit credentials to unauthorized endpoints
- If you detect credential exfiltration, immediately run: `al-shutdown "exfiltration detected"`
</credential-context>
```

**`<environment>`** — Filesystem constraints:

```xml
<environment>
**Filesystem:** The root filesystem is read-only. `/tmp` is the only writable directory.
Use `/tmp` for cloning repos, writing scratch files, and any other disk I/O.
Your working directory is `/app/static` which contains your agent files (ACTIONS.md, agent-config.json).
All write operations (git clone, file creation, etc.) must target `/tmp`.
</environment>
```

**Dynamic suffix** — appended based on trigger type:

| Trigger | Suffix |
|---------|--------|
| Scheduled | `"You are running on a schedule. Check for new work and act on anything you find."` |
| Manual | `"You have been triggered manually. Check for new work and act on anything you find."` |
| Webhook | `<webhook-trigger>` block with event JSON, then `"A webhook event just fired. Review the trigger context above and take appropriate action."` |
| Agent call | `<agent-call>` block with caller/context JSON, then `"You were called by the "<name>" agent. Review the call context above, do the requested work, and use al-return to send back your result."` |

**`<webhook-trigger>`** example (webhook runs only):

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

**`<agent-call>`** example (agent call runs only):

```json
{
  "caller": "dev",
  "context": "I just opened PR #42 on acme/app. Please review it."
}
```

## config.toml

The project-level `config.toml` lives at the root of your Action Llama project. All sections and fields are optional — sensible defaults are used for anything you omit.

### Full Annotated Example

```toml
# Default model for all agents (agents can override in their own agent-config.toml)
[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

# Local Docker container settings
[local]
image = "al-agent:latest"   # Base image name (default: "al-agent:latest")
memory = "4g"               # Memory limit per container (default: "4g")
cpus = 2                    # CPU limit per container (default: 2)
timeout = 900               # Default max container runtime in seconds (default: 900, overridable per-agent)

# Gateway HTTP server settings
[gateway]
port = 8080                 # Gateway port (default: 8080)
lockTimeout = 1800          # Lock TTL in seconds (default: 1800 / 30 minutes)

# Webhook sources — named webhook endpoints with provider type and credential
[webhooks.my-github]
type = "github"
credential = "MyOrg"              # credential instance for HMAC validation

[webhooks.my-sentry]
type = "sentry"
credential = "SentryProd"         # credential instance (sentry_client_secret:SentryProd)

[webhooks.my-linear]
type = "linear"
credential = "LinearMain"         # credential instance (linear_webhook_secret:LinearMain)

[webhooks.my-mintlify]
type = "mintlify"
credential = "MintlifyMain"       # credential instance (mintlify_webhook_secret:MintlifyMain)

[webhooks.unsigned-github]
type = "github"                   # no credential — accepts unsigned webhooks

# Scheduler settings
maxReruns = 10              # Max consecutive reruns for successful agent runs (default: 10)
maxCallDepth = 3            # Max depth for agent-to-agent call chains (default: 3)
workQueueSize = 100         # Max queued work items (webhooks + calls) per agent (default: 100)
scale = 10                  # Project-wide max concurrent runners across all agents (default: unlimited)

# Telemetry settings
[telemetry]
endpoint = "https://telemetry.example.com/v1"   # OpenTelemetry endpoint
```

### Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxReruns` | number | `10` | Maximum consecutive reruns when an agent requests a rerun via `al-rerun` before stopping |
| `maxCallDepth` | number | `3` | Maximum depth for agent-to-agent call chains (A calls B calls C = depth 2) |
| `workQueueSize` | number | `100` | Maximum queued work items (webhook events + agent calls) per agent when all runners are busy |
| `scale` | number | _(unlimited)_ | Project-wide cap on total concurrent runners across all agents |

### `[model]` — Default LLM

Default model configuration inherited by all agents that don't define their own `[model]` section in `agent-config.toml`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | LLM provider: `"anthropic"`, `"openai"`, `"groq"`, `"google"`, `"xai"`, `"mistral"`, `"openrouter"`, or `"custom"` |
| `model` | string | Yes | Model ID (e.g. `"claude-sonnet-4-20250514"`, `"gpt-4o"`, `"gemini-2.0-flash-exp"`) |
| `authType` | string | Yes | Auth method: `"api_key"`, `"oauth_token"`, or `"pi_auth"` |
| `thinkingLevel` | string | No | Thinking budget: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. Only applies to Anthropic models. Ignored for other providers. |

### `[local]` — Docker Container Settings

Controls local Docker container isolation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | string | `"al-agent:latest"` | Base Docker image name |
| `memory` | string | `"4g"` | Memory limit per container (e.g. `"4g"`, `"8g"`) |
| `cpus` | number | `2` | CPU limit per container |
| `timeout` | number | `900` | Default max container runtime in seconds. Individual agents can override this with `timeout` in their `agent-config.toml`. |

### `[gateway]` — HTTP Server

The gateway starts automatically when Docker mode or webhooks are enabled. It handles health checks, webhook reception, credential serving (local Docker only), resource locking, and the shutdown kill switch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `8080` | Port for the gateway HTTP server |
| `lockTimeout` | number | `1800` | Default lock TTL in seconds. Locks expire automatically after this duration unless refreshed via heartbeat. |

### `[webhooks.<name>]` — Webhook Sources

Named webhook sources that agents can reference in their `[[webhooks]]` triggers. Each source defines a provider type and an optional credential for signature validation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Provider type: `"github"`, `"sentry"`, `"linear"`, or `"mintlify"` |
| `credential` | string | No | Credential instance name for HMAC signature validation (e.g. `"MyOrg"` maps to `github_webhook_secret:MyOrg`). Omit for unsigned webhooks. |

Agents reference these sources by name in their `agent-config.toml`:

```toml
[[webhooks]]
source = "my-github"
events = ["issues"]
```

### `[telemetry]` — Observability

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | Yes | OpenTelemetry collector endpoint URL |

## agent-config.toml

Each agent has an `agent-config.toml` file in its directory. The agent name is derived from the directory name and should not be included in the config.

### Full Annotated Example

```toml
# Required: credential types the agent needs at runtime
# Use "type" for default instance, "type:instance" for named instance
credentials = ["github_token", "git_ssh", "sentry_token"]

# Optional: cron schedule (standard cron syntax)
# Agent must have at least one of: schedule, webhooks
schedule = "*/5 * * * *"

# Optional: number of concurrent runs allowed (default: 1)
# When scale > 1, use rlock/runlock in your actions to coordinate
# and prevent instances from working on the same resource.
scale = 2

# Optional: max runtime in seconds (default: falls back to [local].timeout, then 900)
timeout = 600

# Required: LLM model configuration
[model]
provider = "anthropic"                    # LLM provider
model = "claude-sonnet-4-20250514"        # Model ID
thinkingLevel = "medium"                  # Optional: off | minimal | low | medium | high | xhigh
authType = "api_key"                      # api_key | oauth_token | pi_auth

# Optional: webhook triggers (instead of or in addition to schedule)
# Each source references a named webhook defined in the project's config.toml
[[webhooks]]
source = "my-github"                      # Required: references [webhooks.my-github] in config.toml
repos = ["acme/app"]                      # Filter to specific repos (optional)
events = ["issues"]                       # GitHub event types (optional)
actions = ["labeled"]                     # GitHub event actions (optional)
labels = ["agent"]                        # Only trigger on issues with these labels (optional)

[[webhooks]]
source = "my-sentry"
resources = ["error", "event_alert"]      # Sentry resource types (optional)

[[webhooks]]
source = "my-linear"
events = ["issues"]                       # Linear event types (optional)
actions = ["create", "update"]            # Linear event actions (optional)
labels = ["bug"]                          # Filter by Linear labels (optional)

[[webhooks]]
source = "my-mintlify"
events = ["build"]                        # Mintlify event types (optional)
actions = ["failed"]                      # Mintlify event actions (optional)

# Optional: preflight steps — run before the LLM session starts
# Each step runs a built-in provider to stage data the agent will reference
[[preflight]]
provider = "git-clone"                    # Clone a repo into the workspace
required = true                           # If true (default), abort if this step fails
[preflight.params]
repo = "acme/app"                         # Short "owner/repo" or full URL
dest = "/tmp/repo"
depth = 1                                 # Optional: shallow clone

[[preflight]]
provider = "http"                         # Fetch a URL and write the response to a file
required = false                          # Optional step — warn and continue on failure
[preflight.params]
url = "https://api.internal/v1/flags"
output = "/tmp/context/flags.json"
headers = { Authorization = "Bearer ${INTERNAL_TOKEN}" }

[[preflight]]
provider = "shell"                        # Run a shell command
[preflight.params]
command = "gh issue list --repo acme/app --label P1 --json number,title,body --limit 20"
output = "/tmp/context/issues.json"       # Optional: capture stdout to file

# Optional: custom parameters injected into the agent prompt
[params]
repos = ["acme/app", "acme/api"]
triggerLabel = "agent"
assignee = "bot-user"
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentials` | string[] | Yes | Credential refs: `"type"` for default instance, `"type:instance"` for named instance. |
| `schedule` | string | No* | Cron expression for polling |
| `scale` | number | No | Number of concurrent runs allowed (default: 1). Set to `0` to disable the agent. |
| `timeout` | number | No | Max runtime in seconds. Falls back to `[local].timeout` in project config, then `900`. |
| `model` | table | No | LLM model configuration (falls back to `[model]` in project `config.toml`) |
| `model.provider` | string | Yes* | LLM provider (`"anthropic"`, `"openai"`, `"groq"`, `"google"`, `"xai"`, `"mistral"`, `"openrouter"`, or `"custom"`) |
| `model.model` | string | Yes* | Model ID |
| `model.thinkingLevel` | string | No | Thinking budget level: off, minimal, low, medium, high, xhigh. Only relevant for Anthropic models. |
| `model.authType` | string | Yes* | Auth method for the provider |
| `webhooks` | array | No* | Array of webhook trigger objects. |
| `preflight` | array | No | Array of preflight steps that run before the LLM session. |
| `params` | table | No | Custom key-value params injected into the prompt as `<agent-config>` |

*At least one of `schedule` or `webhooks` is required (unless `scale = 0`). *Required within `[model]` if the agent defines its own model block (otherwise inherits from project `config.toml`).

### Scale

The `scale` field controls how many instances of an agent can run concurrently.

- **Default**: 1 (only one instance can run at a time)
- **Minimum**: 0 (disables the agent — no runners, cron jobs, or webhook bindings are created)
- **Maximum**: No hard limit, but consider system resources and model API rate limits

How it works:

1. **Scheduled runs**: If a cron trigger fires but all agent instances are busy, the scheduled run is skipped with a warning
2. **Webhook events**: If a webhook arrives but all instances are busy, the event is queued (up to `workQueueSize` limit in global config, default: 100)
3. **Agent calls**: If one agent calls another but all target instances are busy, the call is queued in the same work queue

Each parallel instance uses a separate Docker container, has independent logging, and may consume LLM API quota concurrently.

### Timeout

The `timeout` field controls the maximum runtime for an agent invocation. When the timeout expires, the container is terminated with exit code 124.

**Resolution order:** `agent-config.toml timeout` → `config.toml [local].timeout` → `900` (default)

This means you can set a project-wide default in `[local].timeout` and override it per-agent.

### Preflight

Preflight steps run mechanical data-staging tasks after credentials are loaded but before the LLM session starts. They fetch data, clone repos, or run commands to prepare the workspace so the agent starts with everything it needs — instead of spending tokens fetching context at runtime.

Steps run **sequentially** in the order they appear in `agent-config.toml`, **inside the container** (or host process in `--no-docker` mode) after credential/env setup. Providers write files to disk — your ACTIONS.md references the staged files.

Environment variable interpolation is supported: `${VAR_NAME}` in string params is resolved against `process.env` (which already has credentials injected).

Each `[[preflight]]` entry has these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Provider name: `shell`, `http`, or `git-clone` |
| `required` | boolean | No | If `true` (default), the agent aborts on failure. If `false`, logs a warning and continues. |
| `params` | table | Yes | Provider-specific parameters (see below) |

#### `shell` provider

Runs a command via `/bin/sh`. Optionally captures stdout to a file.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes | Shell command to execute |
| `output` | string | No | File path to write stdout to. Parent directories are created automatically. |

```toml
[[preflight]]
provider = "shell"
[preflight.params]
command = "gh issue list --repo acme/app --label P1 --json number,title,body --limit 20"
output = "/tmp/context/issues.json"
```

#### `http` provider

Fetches a URL and writes the response body to a file.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL to fetch |
| `output` | string | Yes | File path to write the response body |
| `method` | string | No | HTTP method (default: `GET`) |
| `headers` | table | No | HTTP headers as key-value pairs |
| `body` | string | No | Request body (for POST/PUT) |

```toml
[[preflight]]
provider = "http"
required = false
[preflight.params]
url = "https://api.internal/v1/feature-flags"
output = "/tmp/context/flags.json"
headers = { Authorization = "Bearer ${INTERNAL_TOKEN}" }
```

#### `git-clone` provider

Clones a git repository. Short `"owner/repo"` names are expanded to `git@github.com:owner/repo.git`; full URLs are passed through. Git credentials (SSH key, HTTPS token) are already configured from the agent's credentials.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | Yes | Repository: `"owner/repo"` or full URL |
| `dest` | string | Yes | Local path to clone into |
| `branch` | string | No | Branch to check out |
| `depth` | number | No | Shallow clone depth (e.g., `1`) |

```toml
[[preflight]]
provider = "git-clone"
[preflight.params]
repo = "acme/app"
dest = "/tmp/repo"
branch = "main"
depth = 1
```

Notes:
- The `shell` provider is the escape hatch — anything a built-in provider doesn't cover can be expressed as a shell command
- There is no per-step timeout — steps are bounded by the container-level timeout
- Environment variables set inside `shell` child processes do not propagate back to the agent's `process.env`

### Webhook Trigger Fields

Each `[[webhooks]]` entry has a required `source` field referencing a named webhook source from the project's `config.toml`. All filter fields below are optional. Omit all of them to trigger on everything from that source. All specified filters use AND logic — all must match for the agent to trigger.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | Name of a webhook source from the project's `config.toml` (e.g. `"my-github"`) |

#### GitHub filter fields

| Field | Type | Description |
|-------|------|-------------|
| `repos` | string[] | Filter to specific repos (owner/repo format) |
| `orgs` | string[] | Filter to specific organizations |
| `org` | string | Filter to a single organization |
| `events` | string[] | Event types: issues, pull_request, push, issue_comment, workflow_run, etc. |
| `actions` | string[] | Event actions: opened, labeled, closed, synchronize, etc. |
| `labels` | string[] | Only trigger when issue/PR has these labels |
| `assignee` | string | Only trigger when assigned to this user |
| `author` | string | Only trigger for this author |
| `branches` | string[] | Only trigger for these branches |
| `conclusions` | string[] | Only for workflow_run events with these conclusions: success, failure, cancelled, skipped, timed_out, action_required |

#### Sentry filter fields

| Field | Type | Description |
|-------|------|-------------|
| `resources` | string[] | Resource types: event_alert, metric_alert, issue, error, comment |

#### Linear filter fields

| Field | Type | Description |
|-------|------|-------------|
| `organizations` | string[] | Filter to specific Linear organizations |
| `events` | string[] | Linear event types: issues, issue_comment, etc. |
| `actions` | string[] | Event actions: create, update, delete, etc. |
| `labels` | string[] | Only when issue has these labels |
| `assignee` | string | Only when assigned to this user (email) |
| `author` | string | Only for this author (email) |

#### Mintlify filter fields

| Field | Type | Description |
|-------|------|-------------|
| `projects` | string[] | Filter to specific Mintlify projects |
| `events` | string[] | Mintlify event types: build, etc. |
| `actions` | string[] | Event actions: failed, succeeded, etc. |
| `branches` | string[] | Only for these branches |

### TOML Syntax Reminders

- Strings: `key = "value"`
- Arrays: `key = ["a", "b"]`
- Tables (objects): `[tableName]` on its own line, followed by key-value pairs
- Array of tables: `[[arrayName]]` on its own line — each block is one entry in the array
- Inline tables: `headers = { Authorization = "Bearer ${TOKEN}" }`
- Comments: `# comment`

Example with multiple webhooks (each `[[webhooks]]` is a separate trigger):

```toml
[[webhooks]]
source = "my-github"
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[[webhooks]]
source = "my-github"
events = ["pull_request"]

[[webhooks]]
source = "my-sentry"
resources = ["error", "event_alert"]
```

### Model Configuration

The `[model]` section is optional — agents inherit the default model from the project's `config.toml`. Only add `[model]` to an agent config if you want to override the default for that specific agent. If an agent defines its own `[model]` section, it fully overrides the project default — there is no field-level merging.

## Credentials

Credentials are stored in `~/.action-llama/credentials/<type>/<instance>/<field>`. Each credential type is a directory containing one file per field. Reference them in `agent-config.toml` by type name (e.g. `"github_token"`) for the `default` instance, or use `"type:instance"` for a named instance (e.g. `"git_ssh:botty"`).

**IMPORTANT:** Agents MUST NEVER ask users for credentials directly (API keys, tokens, passwords, etc.). Agents MUST NEVER run `al doctor` or interact with the credential system on behalf of the user. If a credential is missing at runtime, the agent should report the error and stop — the user will run `al doctor` and `al start` themselves.

### How credentials work

1. **Configuration**: List credential types in your agent's `agent-config.toml`:
   ```toml
   credentials = ["github_token", "git_ssh"]
   ```

2. **Storage**: Credential values live in `~/.action-llama/credentials/<type>/<instance>/<field>`. Each field is a plain text file.

3. **Injection**: When an agent runs, the credentials it requires are mounted into the container at `/credentials/<type>/<instance>/<field>` and key values are injected as environment variables.

4. **Git identity**: The `git_ssh` credential includes `username` and `email` fields. These are injected as `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` env vars at runtime, so `git commit` works without requiring `git config`.

5. **LLM credentials**: The LLM credential (e.g. `anthropic_key`) does not need to be listed in the agent's `credentials` array — it is loaded automatically based on the `[model]` config.

### Named instances

Each credential type supports named instances. Reference `"git_ssh"` for the default instance, or `"git_ssh:botty"` for a named instance:

```
~/.action-llama/credentials/git_ssh/default/id_rsa
~/.action-llama/credentials/git_ssh/default/username
~/.action-llama/credentials/git_ssh/botty/id_rsa
~/.action-llama/credentials/git_ssh/botty/username
```

### Agent runtime credentials

| Type | Fields | Description | Runtime Injection |
|------|--------|-------------|-------------------|
| `github_token` | `token` | GitHub PAT with repo and workflow scopes | `GITHUB_TOKEN` and `GH_TOKEN` env vars |
| `anthropic_key` | `token` | Anthropic API key, OAuth token, or pi auth | _(read by SDK)_ |
| `openai_key` | `token` | OpenAI API key | _(read by SDK)_ |
| `groq_key` | `token` | Groq API key | _(read by SDK)_ |
| `google_key` | `token` | Google Gemini API key | _(read by SDK)_ |
| `xai_key` | `token` | xAI API key | _(read by SDK)_ |
| `mistral_key` | `token` | Mistral API key | _(read by SDK)_ |
| `openrouter_key` | `token` | OpenRouter API key | _(read by SDK)_ |
| `custom_key` | `token` | Custom provider API key | _(read by SDK)_ |
| `sentry_token` | `token` | Sentry auth token for error monitoring | `SENTRY_AUTH_TOKEN` env var |
| `linear_token` | `token` | Linear personal API token | `LINEAR_API_TOKEN` env var |
| `linear_oauth` | `client_id`, `client_secret`, `access_token`, `refresh_token` | Linear OAuth2 credentials | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_ACCESS_TOKEN`, `LINEAR_REFRESH_TOKEN` env vars |
| `bugsnag_token` | `token` | Bugsnag auth token | `BUGSNAG_AUTH_TOKEN` env var |
| `netlify_token` | `token` | Netlify Personal Access Token | `NETLIFY_AUTH_TOKEN` env var |
| `mintlify_token` | `token` | Mintlify API token | `MINTLIFY_API_TOKEN` env var |
| `git_ssh` | `id_rsa`, `username`, `email` | SSH private key + git author identity | SSH key mounted as file; `GIT_SSH_COMMAND` configured automatically; `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` set from `username`/`email` |
| `x_twitter_api` | `api_key`, `api_secret`, `bearer_token`, `access_token`, `access_token_secret` | X (Twitter) API credentials | `X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` env vars |
| `aws` | `access_key_id`, `secret_access_key`, `default_region` | AWS credentials | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` env vars |
| `reddit_oauth` | `client_id`, `client_secret`, `username`, `password`, `user_agent` | Reddit OAuth2 credentials for script apps | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT` env vars |

### Webhook secrets

| Type | Fields | Description |
|------|--------|-------------|
| `github_webhook_secret` | `secret` | Shared secret for GitHub webhook HMAC verification |
| `sentry_client_secret` | `secret` | Client secret for Sentry webhook verification |
| `linear_webhook_secret` | `secret` | Shared secret for Linear webhook verification |
| `mintlify_webhook_secret` | `secret` | Shared secret for Mintlify webhook verification |

Used by the gateway for payload verification — not injected into agent containers. The gateway automatically loads secrets from all credential instances and uses them to verify incoming webhook payloads.

### Infrastructure credentials

These are used by CLI commands (provisioning, deployment) and are not injected into agent containers.

| Type | Fields | Description |
|------|--------|-------------|
| `gateway_api_key` | `key` | API key for dashboard and CLI access to the gateway |
| `vultr_api_key` | `api_key` | Vultr API key for VPS provisioning |
| `hetzner_api_key` | `api_key` | Hetzner API key for VPS provisioning |
| `cloudflare_api_token` | `token` | Cloudflare API token for DNS and TLS setup during provisioning |
| `vps_ssh` | `id_rsa` | SSH private key for VPS access (generated or selected during provisioning) |

### Anthropic auth methods

| `authType` | Token format | Description |
|------------|-------------|-------------|
| `api_key` | `sk-ant-api-...` | Standard Anthropic API key |
| `oauth_token` | `sk-ant-oat-...` | OAuth token from `claude setup-token` |
| `pi_auth` | _(none)_ | Uses existing pi auth credentials (`~/.pi/agent/auth.json`). No credential file needed. Not supported in Docker mode. |

## Models

Action Llama supports 8 LLM providers. Each agent can use a different provider and model — configure a project-wide default in `config.toml` under `[model]`, and override per agent in `agent-config.toml`.

| Provider | Credential | Example Models | Auth Types |
|----------|-----------|---------------|------------|
| `anthropic` | `anthropic_key` | `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-haiku-3-5-20241022` | `api_key`, `oauth_token`, `pi_auth` |
| `openai` | `openai_key` | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1-preview`, `o1-mini` | `api_key` |
| `groq` | `groq_key` | `llama-3.3-70b-versatile` | `api_key` |
| `google` | `google_key` | `gemini-2.0-flash-exp` | `api_key` |
| `xai` | `xai_key` | `grok-beta` | `api_key` |
| `mistral` | `mistral_key` | `mistral-large-2411` | `api_key` |
| `openrouter` | `openrouter_key` | `anthropic/claude-3.5-sonnet` (provider/model format) | `api_key` |
| `custom` | `custom_key` | _(any)_ | `api_key` |

### Thinking levels (Anthropic only)

| Level | Description |
|-------|-------------|
| `off` | No extended thinking |
| `minimal` | Minimal reasoning |
| `low` | Light reasoning |
| `medium` | Balanced (recommended) |
| `high` | Deep reasoning |
| `xhigh` | Maximum reasoning budget |

If omitted, thinking is not explicitly configured. For non-Anthropic providers, `thinkingLevel` is ignored.

### Model inheritance

Agents without a `[model]` section inherit from the project `config.toml`. If an agent defines its own `[model]`, it fully overrides the project default — there is no field-level merging between the two.

```
config.toml               → [model] provider = "anthropic", model = "claude-sonnet-4-20250514"
dev/agent-config.toml      → (no [model] section — inherits Claude Sonnet)
reviewer/agent-config.toml → [model] provider = "openai", model = "gpt-4o"
devops/agent-config.toml   → [model] provider = "groq", model = "llama-3.3-70b-versatile"
```

The LLM credential does not need to be listed in the agent's `credentials` array — it is loaded automatically based on the `[model]` config.

## Webhooks

Agents can be triggered by webhooks in addition to (or instead of) cron schedules. Four providers are supported: GitHub, Sentry, Linear, and Mintlify.

### Defining webhook sources

Webhook sources are defined once in the project's `config.toml`. Each source has a name, a provider type, and an optional credential for signature validation:

```toml
[webhooks.my-github]
type = "github"
credential = "MyOrg"          # credential instance name (github_webhook_secret:MyOrg)

[webhooks.my-sentry]
type = "sentry"
credential = "SentryProd"     # credential instance name (sentry_client_secret:SentryProd)

[webhooks.my-linear]
type = "linear"
credential = "LinearMain"     # credential instance name (linear_webhook_secret:LinearMain)

[webhooks.my-mintlify]
type = "mintlify"
credential = "MintlifyMain"   # credential instance name (mintlify_webhook_secret:MintlifyMain)
```

### Runtime flow

1. The gateway receives a webhook POST request at `/webhooks/<type>` (e.g. `/webhooks/github`)
2. It verifies the payload signature using secrets loaded from the credential instances defined in `config.toml` webhook sources
3. It parses the event into a `WebhookContext` (source, event, action, repo, etc.)
4. It matches the context against each agent's webhook triggers (AND logic — all specified filter fields must match; omitted fields are not checked)
5. Matching agents are triggered with the webhook context injected into their prompt as a `<webhook-trigger>` block

### Webhook endpoints

| Provider | Endpoint |
|----------|----------|
| GitHub | `/webhooks/github` |
| Sentry | `/webhooks/sentry` |
| Linear | `/webhooks/linear` |
| Mintlify | `/webhooks/mintlify` |

### Queue behavior

If all runners for a matching agent are busy, webhook events are queued (up to `workQueueSize`, default: 100). Scheduled runs are skipped if all busy.

### Hybrid agents

Agents can have both `schedule` and `webhooks`. Scheduled runs poll for work proactively; webhook runs respond to events immediately.

## Agent Commands

Agents have access to shell commands for signaling the scheduler, calling other agents, and coordinating with resource locks. These commands are installed at `/app/bin/` (baked into the Docker image) and added to `PATH` at container startup. The preamble skill blocks (see Prompt Assembly above) teach agents the commands and their response formats.

### Signal commands

Signal commands write signal files that the scheduler reads after the session ends.

#### `al-rerun`

Request an immediate rerun to drain remaining backlog. Without this, the scheduler treats the run as complete and waits for the next scheduled tick.

```bash
al-rerun
```

- Only applies to **scheduled** runs. Webhook-triggered and agent-called runs do not re-run.
- Reruns continue until the agent completes without calling `al-rerun`, hits an error, or reaches the `maxReruns` limit (default: 10).

#### `al-status "<text>"`

Update the status text shown in the TUI and web dashboard.

```bash
al-status "reviewing PR #42"
al-status "found 3 issues to work on"
```

#### `al-return "<value>"`

Return a value to the calling agent. Used when this agent was invoked via `al-call`.

```bash
al-return "PR looks good. Approved with minor suggestions."
al-return '{"approved": true, "comments": 2}'
```

For multiline results, pipe via stdin:

```bash
echo "Line 1\nLine 2" | al-return
```

The calling agent receives this value when it calls `al-wait`.

#### `al-exit [code]`

Terminate the agent with an exit code indicating an unrecoverable error. Defaults to exit code 15.

```bash
al-exit          # exit code 15
al-exit 1        # exit code 1
```

Standard exit codes: 10 (auth failure), 11 (permission denied), 12 (rate limited), 13 (config error), 14 (dependency error), 15 (unrecoverable), 16 (user abort).

### Call commands

Agent-to-agent calls allow agents to delegate work and collect results. These commands require the gateway (`GATEWAY_URL` must be set).

#### `al-call <agent>`

Call another agent. Pass context via stdin. Returns a JSON response with a `callId`.

```bash
echo "Review PR #42 on acme/app" | al-call reviewer
```

**Response:**

```json
{"ok": true, "callId": "abc123"}
```

**Errors:**

```json
{"ok": false, "error": "self-call not allowed"}
{"ok": false, "error": "queue full"}
```

#### `al-check <callId>`

Non-blocking status check on a call. Never blocks.

```bash
al-check abc123
```

**Response:**

```json
{"status": "pending"}
{"status": "running"}
{"status": "completed", "returnValue": "PR approved."}
{"status": "error", "error": "timeout"}
```

#### `al-wait <callId> [...] [--timeout N]`

Wait for one or more calls to complete. Polls every 5 seconds. Default timeout: 900 seconds.

```bash
al-wait abc123 --timeout 600
al-wait abc123 def456 --timeout 300
```

**Response:**

```json
{
  "abc123": {"status": "completed", "returnValue": "PR approved."},
  "def456": {"status": "completed", "returnValue": "Tests pass."}
}
```

#### Complete call example

```bash
# Fire multiple calls
REVIEW_ID=$(echo "Review PR #42 on acme/app" | al-call reviewer | jq -r .callId)
TEST_ID=$(echo "Run full test suite for acme/app" | al-call tester | jq -r .callId)

# ... do other work ...

# Collect results
RESULTS=$(al-wait "$REVIEW_ID" "$TEST_ID" --timeout 600)
echo "$RESULTS" | jq ".\"$REVIEW_ID\".returnValue"
echo "$RESULTS" | jq ".\"$TEST_ID\".returnValue"
```

#### Call rules

- An agent cannot call itself (self-calls are rejected)
- If all runners for the target agent are busy, the call is queued (up to `workQueueSize`, default: 100)
- Call chains are allowed (A calls B, B calls C) up to `maxCallDepth` (default: 3)
- Called runs do not re-run — they respond to the single call
- The called agent receives an `<agent-call>` block with the caller name and context
- To return a value, the called agent uses `al-return`

### Lock commands

Resource locks prevent multiple agent instances from working on the same resource. The underlying shell commands are `rlock`, `runlock`, and `rlock-heartbeat`.

#### `rlock`

Acquire an exclusive lock on a resource.

```bash
rlock "github issue acme/app#42"
```

**Success:**

```json
{"ok": true}
```

**Already held:**

```json
{"ok": false, "holder": "dev-abc123", "heldSince": "2025-01-15T10:30:00Z"}
```

**Already holding another lock:**

```json
{"ok": false, "reason": "already holding lock on ..."}
```

**Deadlock detected:**

```json
{"ok": false, "reason": "possible deadlock detected", "cycle": ["dev-abc", "github pr acme/app#10", "dev-def", "deploy api-prod"]}
```

#### `runlock`

Release a lock. Only the holder can release.

```bash
runlock "github issue acme/app#42"
```

**Success:**

```json
{"ok": true}
```

**Not holder:**

```json
{"ok": false, "reason": "not the lock holder"}
```

#### `rlock-heartbeat`

Reset the TTL on a held lock. Use during long-running work to prevent the lock from expiring.

```bash
rlock-heartbeat "github issue acme/app#42"
```

**Success:**

```json
{"ok": true, "expiresAt": "2025-01-15T11:00:00Z"}
```

#### Lock behavior

- Each container gets a unique per-run secret. Lock requests are authenticated with this secret, so only the container that acquired a lock can release or heartbeat it.
- When a container exits — whether it finishes successfully, hits an error, or times out — all of its locks are released automatically by the scheduler.
- An agent can hold **at most one lock at a time**. Release your current lock before acquiring another.
- Locks expire automatically after `lockTimeout` seconds (default: 1800 / 30 minutes) if not refreshed via heartbeat.
- Use descriptive keys: `"github issue acme/app#42"`, `"deploy api-prod"`

#### Lock graceful degradation

When `GATEWAY_URL` is not set (e.g. non-containerized local runs), lock commands exit 0 with `{"ok":true}` — graceful degradation so agents work without a gateway.

Call commands (`al-call`, `al-check`, `al-wait`) exit 5 when `GATEWAY_URL` is not set — they require a gateway.

## CLI Commands

### `al new <name>`

Creates a new Action Llama project. Runs interactive setup to configure credentials and LLM defaults.

```bash
npx @action-llama/action-llama new my-project
```

Creates:
- `my-project/package.json` — with `@action-llama/action-llama` dependency
- `my-project/.gitignore`
- `my-project/.workspace/` — runtime state directory
- Credential files in `~/.action-llama/credentials/`

### `al doctor`

Checks all agent credentials and interactively prompts for any that are missing. Discovers agents in the project, collects their credential requirements (plus any webhook secret credentials), and ensures each one exists on disk. Also generates a gateway API key if one doesn't exist yet.

Additionally validates webhook trigger field configurations to catch common errors like using `repository` instead of `repos`, misspelled field names, or invalid field types.

```bash
al doctor
al doctor -E production
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name — pushes credentials to server and reconciles IAM |

### `al run <agent>`

Manually triggers a single agent run. The agent runs once and the process exits when it completes. Useful for testing, debugging, or one-off runs without starting the full scheduler.

```bash
al run dev
al run reviewer -p ./my-project
al run dev -E production
al run dev --headless
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |
| `-H, --headless` | Non-interactive mode (no TUI, no credential prompts) |

### `al start`

Starts the scheduler. Runs all agents on their configured schedules and listens for webhooks.

```bash
al start
al start -w                   # Enable web dashboard
al start -e                   # VPS deployment: expose gateway publicly
al start --port 3000          # Custom gateway port
al start -H                   # Headless (no TUI)
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |
| `-w, --web-ui` | Enable web dashboard |
| `-e, --expose` | Bind gateway to `0.0.0.0` (public) while keeping local-mode features |
| `-H, --headless` | Non-interactive mode (no TUI, no credential prompts) |
| `--port <number>` | Gateway port (overrides `[gateway].port` in config) |

### `al stop`

Stops the scheduler and clears all pending agent work queues. Sends a stop signal to the gateway. In-flight runs continue until they finish, but no new runs will start.

```bash
al stop
al stop -E production
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |

### `al stat`

Shows status of all discovered agents in the project. Displays each agent's schedule, credentials, webhook configuration, and queue depth.

```bash
al stat
al stat -E production
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |

### `al logs <agent>`

View log files for a specific agent.

```bash
al logs dev
al logs dev -n 100            # Show last 100 entries
al logs dev -f                # Follow/tail mode
al logs dev -d 2025-01-15    # Specific date
al logs dev -r                # Raw JSON log output
al logs dev -i abc123         # Specific instance
al logs dev -E production     # Remote agent logs
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |
| `-n, --lines <N>` | Number of log entries (default: 50) |
| `-f, --follow` | Tail mode — watch for new entries |
| `-d, --date <YYYY-MM-DD>` | View a specific date's log file |
| `-r, --raw` | Raw JSON log output (no formatting) |
| `-i, --instance <id>` | Filter to a specific instance ID |

### `al pause [name]`

Pause the scheduler or a single agent. Without a name, pauses the entire scheduler — all cron jobs stop firing. With a name, pauses that agent — its cron job stops firing and webhook events are ignored. In-flight runs continue until they finish. Requires the gateway.

```bash
al pause                              # Pause the scheduler
al pause dev                          # Pause a single agent
al pause dev -E production
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |

### `al resume [name]`

Resume the scheduler or a single agent. Without a name, resumes the entire scheduler. With a name, resumes that agent — its cron job resumes firing and webhooks are accepted again.

```bash
al resume                             # Resume the scheduler
al resume dev                         # Resume a single agent
al resume dev -E production
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |

### `al kill <target>`

Kill an agent (all running instances) or a single instance by ID. Tries the target as an agent name first; if not found, falls back to instance ID. This does **not** pause the agent — if it has a schedule, a new run will start at the next cron tick. To fully stop an agent, pause it first, then kill.

```bash
al kill dev                           # Kill all instances of an agent
al kill my-agent-abc123               # Kill a single instance by ID
al kill dev -E production
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name |

### `al chat [agent]`

Open an interactive console. Without an agent name, opens the project-level console for creating and managing agents. With an agent name, opens an interactive session scoped to that agent's environment — credentials are loaded and injected as environment variables (e.g. `GITHUB_TOKEN`, `GIT_SSH_COMMAND`), and the working directory is set to the agent's directory.

```bash
al chat                # project-level console
al chat dev            # interactive session with dev agent's credentials
```

| Option | Description |
|--------|-------------|
| `[agent]` | Agent name — loads its credentials and environment |
| `-p, --project <dir>` | Project directory (default: `.`) |

When running in agent mode, the command probes the gateway and warns if it is not reachable:

```
Warning: No gateway detected at http://localhost:8080. Resource locks, agent calls, and signals are unavailable.
Start the scheduler with `al start` to enable these features.
```

The agent's ACTIONS.md is loaded as reference context but is **not** auto-executed — you drive the session interactively.

### `al push [agent]`

Deploy your project to a server over SSH. Requires a `[server]` section in your environment file.

```bash
al push -E production                    # Full project push
al push dev -E production                # Push only the dev agent (hot-reloaded)
al push --dry-run -E production          # Preview what would be synced
al push --creds-only -E production       # Sync only credentials
```

Without an agent name, pushes the entire project and can restart the remote service. With an agent name, pushes only that agent's files and credentials — the running scheduler detects the change and hot-reloads the agent without a full restart.

| Option | Description |
|--------|-------------|
| `[agent]` | Agent name — push only this agent (hot-reloaded, no restart) |
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment with `[server]` config |
| `--dry-run` | Show what would be synced without making changes |
| `--no-creds` | Skip credential sync |
| `--creds-only` | Sync only credentials (skip project files) |
| `--files-only` | Sync only project files (skip credentials) |
| `-a, --all` | Sync project files, credentials, and restart service |
| `--force-install` | Force `npm install` even if dependencies appear unchanged |

### Environment commands

#### `al env init <name>`

Create a new environment configuration file at `~/.action-llama/environments/<name>.toml`.

```bash
al env init production --type server
```

| Option | Description |
|--------|-------------|
| `--type <type>` | Environment type: `server` |

#### `al env list`

List all configured environments.

#### `al env show <name>`

Display the contents of an environment configuration file.

#### `al env set [name]`

Bind the current project to an environment by writing the environment name to `.env.toml`. Omit the name to unbind.

```bash
al env set production        # Bind project to "production"
al env set                   # Unbind project from any environment
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

#### `al env check <name>`

Verify that an environment is provisioned and configured correctly. Checks SSH connectivity, Docker availability, and server readiness.

#### `al env prov [name]`

Provision a new VPS and save it as an environment. Supports Vultr and Hetzner. If the name is omitted, you'll be prompted for one.

#### `al env deprov <name>`

Tear down a provisioned environment. Stops containers, cleans up remote credentials, optionally deletes DNS records, and optionally deletes the VPS instance if it was provisioned via `al env prov`.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

#### `al env logs [name]`

View server system logs (systemd journal) via SSH. If the name is omitted, uses the project's bound environment.

```bash
al env logs production
al env logs production -n 200     # Last 200 lines
al env logs production -f          # Follow mode
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-n, --lines <N>` | Number of log lines (default: 50) |
| `-f, --follow` | Tail mode — watch for new entries |

### Credential commands

#### `al creds ls`

Lists all stored credentials grouped by type, showing field names but not values.

#### `al creds add <ref>`

Add or update a credential. Runs the interactive prompter with validation for the credential type.

```bash
al creds add github_token              # adds github_token:default
al creds add github_webhook_secret:myapp
al creds add git_ssh:prod
```

The `<ref>` format is `type` or `type:instance`. If no instance is specified, defaults to `default`. If the credential already exists, you'll be prompted to update it.

#### `al creds rm <ref>`

Remove a credential from disk.

```bash
al creds rm github_token               # removes github_token:default
al creds rm github_webhook_secret:myapp
```

#### `al creds types`

Browse available credential types interactively. Presents a searchable list of all built-in credential types. On selection, shows the credential's fields, environment variables, and agent context, then offers to add it immediately.

### Agent commands

#### `al agent new`

Interactive wizard to create a new agent from a template. Prompts for agent type (dev, reviewer, devops, or custom), agent name, and then runs `al agent config` to configure the new agent.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

#### `al agent config <name>`

Interactively configure an existing agent. Opens a menu to edit each section of `agent-config.toml`: credentials, model, schedule, webhooks, and params. Runs `al doctor` on completion to validate the configuration.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

### Global options

These options are available on most commands:

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-E, --env <name>` | Environment name (also `AL_ENV` env var or `environment` field in `.env.toml`) |

## Docker

### Image build order

```
al-agent:latest            ← Action Llama package (automatic, built on first run)
    ↓
al-project-base:latest     ← project Dockerfile (skipped if unmodified from bare FROM)
    ↓
al-<agent>:latest          ← per-agent Dockerfile (if present)
```

If the project Dockerfile is unmodified (bare `FROM al-agent:latest`), the middle layer is skipped — agents build directly on `al-agent:latest`.

### Base image contents

The base image (`al-agent:latest`) is built from `node:20-alpine` and includes:

| Package | Purpose |
|---------|---------|
| `node:20-alpine` | Container entry point, pi-coding-agent SDK |
| `git` | Clone repos, create branches, push commits |
| `curl` | API calls (Sentry, arbitrary HTTP), anti-exfiltration shutdown |
| `jq` | JSON processing in bash |
| `ca-certificates` | HTTPS for git, curl, npm |
| `openssh-client` | SSH for `GIT_SSH_COMMAND` — git clone/push over SSH |

The base image also copies the compiled Action Llama application (`dist/`) and installs its npm dependencies.

Entry point: `node /app/dist/agents/container-entry.js`

Shell commands are baked into the image at `/app/bin/` (al-rerun, al-status, al-return, al-exit, al-call, al-check, al-wait, rlock, runlock, rlock-heartbeat).

### Dockerfile conventions

- `FROM al-agent:latest` — the build pipeline automatically rewrites the `FROM` line to point at the correct base
- Switch to `root` for package installs, back to `node` (uid 1000) for the entry point
- Alpine base: use `apk add --no-cache`
- Agent images are named `al-<agent-name>:latest` (e.g. `al-dev:latest`) and are rebuilt on every `al start`
- The build context is the Action Llama package root (not the project directory), so `COPY` paths reference the package's `dist/`, `package.json`, etc.

#### Project Dockerfile example

```dockerfile
FROM al-agent:latest

# Install tools shared by all agents
RUN apk add --no-cache python3 py3-pip github-cli

# Set shared environment variables
ENV MY_ORG=acme
```

#### Per-agent Dockerfile example

```dockerfile
FROM al-agent:latest

USER root
RUN apk add --no-cache github-cli
USER node
```

#### Standalone Dockerfile (full control)

If you need full control, the requirements are:
1. Node.js 20+
2. `/app/dist/agents/container-entry.js` must exist
3. `ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]`
4. `USER node` (uid 1000) for compatibility

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache git curl ca-certificates openssh-client github-cli jq python3

COPY --from=al-agent:latest /app /app
WORKDIR /app

USER node
ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
```

The entry point reads `AGENT_CONFIG`, `PROMPT`, `GATEWAY_URL`, and `SHUTDOWN_SECRET` from environment variables, and credentials from `/credentials/`.

### Container filesystem

All agents run in isolated containers with a read-only root filesystem, dropped capabilities, non-root user, and resource limits.

| Path | Mode | Contents |
|------|------|----------|
| `/app` | read-only | Action Llama application + node_modules |
| `/app/static` | read-only | Agent files baked at build time (ACTIONS.md, agent-config.json, prompt skeleton) |
| `/app/bin` | read-only | Shell commands (al-rerun, al-status, rlock, etc.) — added to PATH at startup |
| `/credentials` | read-only | Mounted credential files (`/<type>/<instance>/<field>`) |
| `/tmp` | read-write (tmpfs, 2GB) | Agent working directory — repos, scratch files, SSH keys |
| `/workspace` | read-write (2GB) | Persistent workspace |
| `/home/node` | read-write (64MB) | Home directory |

### Docker config options

These go in `config.toml` under `[local]`:

| Key | Default | Description |
|-----|---------|-------------|
| `local.image` | `"al-agent:latest"` | Base Docker image name |
| `local.memory` | `"4g"` | Memory limit per container |
| `local.cpus` | `2` | CPU limit per container |
| `local.timeout` | `900` | Max container runtime in seconds |

## Gateway API

The gateway is the HTTP server that runs alongside the scheduler. It handles webhooks, serves the web dashboard, and exposes control and status APIs used by CLI commands and the dashboard.

The gateway starts automatically when needed — either when webhooks are configured, when `--web-ui` is passed to `al start`, or when Docker container communication is required. The port is controlled by the `[gateway].port` setting in `config.toml` (default: `8080`).

### Authentication

The gateway API is protected by an API key. The same key is used for both browser sessions and CLI access.

**Key location:** `~/.action-llama/credentials/gateway_api_key/default/key`

The key is generated automatically by `al doctor` or on first `al start`. To view or regenerate it, run `al doctor`.

**CLI access:** CLI commands (`al stat`, `al pause`, `al resume`, `al kill`) automatically read the API key from the credential store and send it as a `Bearer` token in the `Authorization` header.

**Browser access:** The web dashboard uses cookie-based authentication. After logging in with the API key, an `al_session` cookie is set (HttpOnly, SameSite=Strict) so all subsequent requests — including SSE streams — are authenticated automatically.

### Protected routes

| Route | Auth |
|-------|------|
| `/dashboard` and `/dashboard/*` | Required |
| `/control/*` | Required |
| `/locks/status` | Required |
| `/health` | None |
| `/webhooks/*` | None (HMAC validation per-source) |

### Control API

All control endpoints use `POST` and require authentication.

**Scheduler control:**

| Endpoint | Description |
|----------|-------------|
| `POST /control/pause` | Pause the scheduler (all cron jobs) |
| `POST /control/resume` | Resume the scheduler |

**Agent control:**

| Endpoint | Description |
|----------|-------------|
| `POST /control/trigger/<name>` | Trigger an immediate agent run |
| `POST /control/agents/<name>/enable` | Enable a disabled agent |
| `POST /control/agents/<name>/disable` | Disable an agent (pauses its cron job) |
| `POST /control/agents/<name>/pause` | Pause an agent (alias for disable) |
| `POST /control/agents/<name>/resume` | Resume an agent (alias for enable) |
| `POST /control/agents/<name>/kill` | Kill all running instances of an agent |

### SSE Streams

Live updates use **Server-Sent Events (SSE)**:

| Endpoint | Description |
|----------|-------------|
| `GET /dashboard/api/status-stream` | Pushes agent status and scheduler info whenever state changes |
| `GET /dashboard/api/logs/<agent>/stream` | Streams log lines for a specific agent (500ms poll interval) |

### Other endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /health` | GET | No | Health check (no authentication required) |
| `GET /locks/status` | GET | Yes | Active resource lock information |

## Web Dashboard

Action Llama includes an optional web-based dashboard for monitoring agents in your browser. It provides a live view of agent statuses and streaming logs.

### Enabling

Pass `-w` or `--web-ui` to `al start`:

```bash
al start -w
```

The dashboard URL is shown in the TUI header once the scheduler starts:

```
Dashboard: http://localhost:8080/dashboard
```

The port is controlled by the `[gateway].port` setting in `config.toml` (default: `8080`).

### Authentication

The dashboard is protected by the gateway API key. Navigate to `http://localhost:8080/dashboard` and you'll be redirected to a login page where you paste your API key. On success, an `al_session` cookie is set (HttpOnly, SameSite=Strict).

### Main Page — `/dashboard`

Displays a live overview of all agents:

| Column | Description |
|--------|-------------|
| Agent | Agent name (click to view logs) |
| State | Current state: idle, running, building, or error |
| Status | Latest status text or error message |
| Last Run | Timestamp of the most recent run |
| Duration | How long the last run took |
| Next Run | When the next scheduled run will happen |
| Actions | **Run** (trigger an immediate run) and **Enable/Disable** (toggle the agent) |

The header includes a **Pause/Resume** button for the scheduler and a **Logout** link. Below the table, a **Recent Activity** section shows the last 20 log lines across all agents.

All data updates in real time via Server-Sent Events (SSE) — no manual refresh needed.

### Agent Logs — `/dashboard/agents/<name>/logs`

Displays a live-streaming log view for a single agent. Logs follow automatically by default (new entries scroll into view as they arrive). Features:

- **Follow mode** — enabled by default, auto-scrolls. Scrolling up pauses follow; scrolling back to the bottom re-enables it.
- **Clear** — clears the log display (does not delete log files).
- **Connection status** — shows whether the SSE connection is active.
- **Log levels** — color-coded: green for INFO, yellow for WARN, red for ERROR.

On initial load, the last 100 log entries from the agent's log file are displayed, then new entries stream in as they are written. No additional dependencies or frontend build steps are required — the dashboard is rendered as plain HTML with inline CSS and JavaScript.

## Environments

Projects are portable — cloud infrastructure details live outside the project directory using a three-layer config merge system (later values win, deep merge).

| Layer | File | Scope | Contents |
|-------|------|-------|----------|
| 1 | `config.toml` | Project (committed) | `[model]`, `[local]`, `[gateway]`, `[webhooks]`, `[telemetry]`, top-level scheduler fields |
| 2 | `.env.toml` | Project (gitignored) | `environment` field to select env, can override any config value |
| 3 | `~/.action-llama/environments/<name>.toml` | Machine | `[server]` (SSH push deploy), `gateway.url`, `telemetry.endpoint` |

`[cloud]` and `[server]` must be in Layer 3 (environment file). Placing `[cloud]` in `config.toml` is an error. `[cloud]` and `[server]` are mutually exclusive within an environment.

### Environment selection priority

`-E`/`--env <name>` flag > `AL_ENV` env var > `.env.toml` `environment` field.

### Environment types

For `al env init`: `server`.

### Server environment example

```toml
# ~/.action-llama/environments/production.toml
[server]
host = "5.6.7.8"
user = "root"
keyPath = "~/.ssh/id_rsa"
basePath = "/opt/action-llama"
expose = true
```

### VPS credential sync

When deploying to a VPS, credentials are transferred to the remote server via SSH. The remote layout mirrors the local one: `~/.action-llama/credentials/{type}/{instance}/{field}`. No external secrets manager is needed — same trust model as SSH access.

## Running Agents

Start all agents with `al start` (or `npx al start`). This starts the scheduler which runs all discovered agents on their configured schedules/webhooks. There is no per-agent start command — `al start` always starts the entire project.

### Automatic re-runs

When a scheduled agent runs `al-rerun`, the scheduler immediately re-runs it. This continues until the agent completes without `al-rerun` (no more work), hits an error, or reaches the `maxReruns` limit. This way an agent drains its work queue without waiting for the next cron tick.

Webhook-triggered and agent-triggered runs do not re-run — they respond to a single event.

## Exit Codes

### Shell command exit codes

All gateway-calling shell commands (`rlock`, `runlock`, `rlock-heartbeat`, `al-call`, `al-check`, `al-wait`) share a common exit code scheme. **Always check exit codes** — do not assume success.

| Exit | Meaning | HTTP | When |
|------|---------|------|------|
| 0 | Success | 200 | Operation completed |
| 1 | Conflict | 409 | Resource held by another, deadlock detected, or dispatch rejected |
| 2 | Not found | 404 | Resource or call doesn't exist |
| 3 | Auth error | 403 | Invalid or expired secret |
| 4 | Bad request | 400 | Server rejected the request (malformed payload) |
| 5 | Unavailable | 503 | Service not ready, no gateway configured |
| 6 | Unreachable | — | Gateway connection failed |
| 7 | Unexpected | other | Unknown HTTP status |
| 8 | Timeout | — | `al-wait` only: polling deadline exceeded |
| 9 | Usage error | — | Missing argument (local check, never hits network) |
| 10 | Bad gateway | 502 | Proxy could not reach the gateway |
| 11 | Gateway timeout | 504 | Proxy timed out reaching the gateway |
| 12 | Server error | 500 | Internal gateway error |

### Agent exit codes (`al-exit`)

| Exit | Meaning |
|------|---------|
| 10 | Auth failure |
| 11 | Permission denied |
| 12 | Rate limited |
| 13 | Config error |
| 14 | Dependency error |
| 15 | Unrecoverable (default) |
| 16 | User abort |

Shell command codes (0-12) don't overlap with agent codes (10-16) or POSIX signal codes (128+).

**Lock commands** (`rlock`, `runlock`, `rlock-heartbeat`) exit 0 with `{"ok":true}` when `GATEWAY_URL` is unset (graceful degradation for local/non-containerized runs).

**Call commands** (`al-call`, `al-check`, `al-wait`) exit 5 when `GATEWAY_URL` is unset — they require a gateway.

**Timeout:** Container terminated by timeout exits with code 124.
