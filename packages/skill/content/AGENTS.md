# Action Llama Reference

CLI for running LLM agents on cron/webhooks. Docker isolation, SKILL.md prompt, credentials. Gateway: webhooks, locking, agent calls, dashboard.

Package: `@action-llama/action-llama`. CLI binary: `al`.

## Project Structure

```
my-project/
  config.toml              # Project config — models, local, gateway, webhooks, telemetry (committed)
  .env.toml                # Environment binding — selects an environment, can override config (gitignored)
  Dockerfile               # Project base Docker image — shared tools for all agents (committed)
  AGENTS.md                # Shared instructions loaded by `al chat` (interactive only)
  CLAUDE.md                # Instructions for AI dev tools — not read by Action Llama at runtime
  agents/
    <agent>/
      SKILL.md             # Portable metadata (YAML frontmatter) + instructions (markdown body)
      config.toml          # Per-agent runtime config — credentials, models, schedule, webhooks, hooks, params (committed)
      Dockerfile           # Custom Docker image for this agent (optional)
```

Agent names derive from directory name. `"default"` is reserved.

### SKILL.md — Writing Tips

- Direct LLM instructions; numbered steps; reference `<agent-config>` for params (params come from `config.toml [params]`)
- Runtime config (credentials, schedule, models, webhooks, etc.) lives in `agents/<name>/config.toml`, not SKILL.md frontmatter
- `al-status` at milestones, `al-rerun` when backlog remains; keep concise

## Prompt Assembly

The LLM receives two messages:

### System message

The SKILL.md body is the system prompt. With gateway, **skill blocks** appended:

#### Locking skill block (injected when gateway is available)

```xml
<skill-lock>
## Skill: Resource Locking

Use locks to coordinate with other agent instances and avoid duplicate work.
You may hold **at most one lock at a time**. Release your current lock before acquiring another.

**Important:** Resource keys must be valid URIs with proper schemes (e.g., github://, file://, https://).

### Commands

**`rlock <resourceKey>`** — Acquire an exclusive lock before working on a shared resource.
```
rlock "github://acme/app/issues/42"
```

**`runlock <resourceKey>`** — Release a lock when done with the resource.
```
runlock "github://acme/app/issues/42"
```

**`rlock-heartbeat <resourceKey>`** — Extend the TTL on a lock you hold. Use during long-running work.
```
rlock-heartbeat "github://acme/app/issues/42"
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
- Resource keys must be valid URIs: `"github://acme/app/issues/42"`, `"file:///deployments/api-prod"`
</skill-lock>
```

#### Subagent skill block (injected when gateway is available)

```xml
<skill-subagent>
## Skill: Subagents

Call other agents and retrieve their results. Calls are **non-blocking** — fire a call, continue working, then check or wait for results.

### Commands

**`al-subagent <agent>`** — Call another agent. Pass the context via stdin. Returns a call ID.
```
CALL_ID=$(echo "find competitors for Acme" | al-subagent researcher | jq -r .callId)
```

**`al-subagent-check <callId>`** — Check the status of a call. Never blocks.
```
al-subagent-check "$CALL_ID"
```
- Running: `{"status":"running"}`
- Completed: `{"status":"completed","returnValue":"..."}`
- Error: `{"status":"error","errorMessage":"..."}`

**`al-subagent-wait <callId> [callId...] [--timeout N]`** — Wait for one or more calls to complete. Default timeout: 900s.
```
RESULTS=$(al-subagent-wait "$CALL_ID1" "$CALL_ID2" --timeout 600)
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
- Use `al-subagent-wait` to wait for multiple calls efficiently
- Use `al-subagent-check` for polling when you want to do work between checks
- Called agents cannot call back to the calling agent (no cycles)
- There is a depth limit on nested calls to prevent infinite chains
</skill-subagent>
```

### User message

Static skeleton + dynamic suffix. Static blocks:

**`<agent-config>`** — `[params]` as JSON:

```xml
<agent-config>
{"repos":["acme/app"],"triggerLabel":"agent","assignee":"bot-user"}
</agent-config>
```

**`<credential-context>`** — env vars, tools, anti-exfiltration:

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

**`<environment>`** — Filesystem:

```xml
<environment>
**Filesystem:** The root filesystem is read-only. `/tmp` is the only writable directory.
Use `/tmp` for cloning repos, writing scratch files, and any other disk I/O.
Your working directory is `/app/static` which contains your agent files (SKILL.md, agent-config.json).
All write operations (git clone, file creation, etc.) must target `/tmp`.

**Environment variables:** Use `setenv NAME value` to persist variables across bash commands.
</environment>
```

**Dynamic suffix** — by trigger type:

| Trigger | Suffix |
|---------|--------|
| Scheduled | `"You are running on a schedule. Check for new work and act on anything you find."` |
| Manual | `"You have been triggered manually. Check for new work and act on anything you find."` |
| Webhook | `<webhook-trigger>` block with event JSON, then `"A webhook event just fired. Review the trigger context above and take appropriate action."` |
| Agent call | `<agent-call>` block with caller/context JSON, then `"You were called by the "<name>" agent. Review the call context above, do the requested work, and use al-return to send back your result."` |

**`<webhook-trigger>`** example:

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

**`<agent-call>`** example:

```json
{
  "caller": "dev",
  "context": "I just opened PR #42 on acme/app. Please review it."
}
```

## config.toml

Project root. All sections optional — sensible defaults apply.

### Full Annotated Example

```toml
# Named models — define once, reference by name in SKILL.md
[models.sonnet]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[models.haiku]
provider = "anthropic"
model = "claude-haiku-4-5-20251001"
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
resourceLockTimeout = 1800  # Lock TTL in seconds (default: 1800 / 30 minutes)
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
| `defaultAgentScale` | number | `1` | Default scale for agents without an explicit per-agent config.toml scale |
| `historyRetentionDays` | number | `14` | How many days to keep trigger history and webhook receipts |
| `resourceLockTimeout` | number | `1800` | Default lock TTL in seconds. Locks expire automatically after this duration unless refreshed via heartbeat. |

### `[models.<name>]` — Named Models

Define models once, reference by name in SKILL.md `models:` list. First in list is primary; rest are fallbacks tried in order on rate limits.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | LLM provider: `"anthropic"`, `"openai"`, `"groq"`, `"google"`, `"xai"`, `"mistral"`, `"openrouter"`, or `"custom"` |
| `model` | string | Yes | Model ID (e.g. `"claude-sonnet-4-20250514"`, `"gpt-4o"`, `"gemini-2.0-flash-exp"`) |
| `authType` | string | Yes | Auth method: `"api_key"`, `"oauth_token"`, or `"pi_auth"` |
| `thinkingLevel` | string | No | Thinking budget: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. Only applies to Anthropic models. Ignored for other providers. |

### `[local]` — Docker Container Settings

Local Docker container settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | string | `"al-agent:latest"` | Base Docker image name |
| `memory` | string | `"4g"` | Memory limit per container (e.g. `"4g"`, `"8g"`) |
| `cpus` | number | `2` | CPU limit per container |
| `timeout` | number | `900` | Default max container runtime in seconds. Individual agents can override this with `timeout` in their `agents/<name>/config.toml`. |

### `[gateway]` — HTTP Server

Starts automatically when Docker mode or webhooks enabled.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `8080` | Port for the gateway HTTP server |

### `[webhooks.<name>]` — Webhook Sources

Named sources agents reference in `[[webhooks]]` triggers.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Provider type: `"github"`, `"sentry"`, `"linear"`, or `"mintlify"` |
| `credential` | string | No | Instance name for HMAC validation (e.g. `"MyOrg"` -> `github_webhook_secret:MyOrg`). Omit for unsigned. |

Agents reference by name:

```toml
[[webhooks]]
source = "my-github"
events = ["issues"]
```

### `[telemetry]` — Observability

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | Yes | OpenTelemetry collector endpoint URL |

## SKILL.md

Portable agent definition. YAML frontmatter contains portable metadata (name, description, license, compatibility), markdown body contains LLM instructions. Runtime configuration lives in a separate `config.toml` per agent.

### Full Annotated Example

```yaml
---
name: dev-agent
description: Solves GitHub issues by writing and testing code
license: MIT
compatibility: ">=0.5.0"
---

# Dev Agent

You are a development agent. Pick the highest priority issue and fix it.
```

### SKILL.md Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Human-readable name (defaults to directory name) |
| `description` | string | No | Short description of what the agent does |
| `license` | string | No | License identifier (e.g. `"MIT"`) |
| `compatibility` | string | No | Semver range for Action Llama compatibility |

## config.toml (per-agent)

Runtime configuration for the agent. Lives at `agents/<name>/config.toml`. This file is project-local (not portable with the skill).

### Full Annotated Example

```toml
# Install origin — used by `al update` to pull upstream SKILL.md changes
source = "acme/dev-skills"

# Required: named model references from project config.toml [models.*]
# First in list is primary; rest are fallbacks tried on rate limits
models = ["sonnet", "haiku"]

# Required: credential types the agent needs at runtime
# Use "type" for default instance, "type:instance" for named instance
credentials = ["github_token", "git_ssh", "sentry_token"]

# Optional: cron schedule (standard cron syntax)
# Agent must have at least one of: schedule, webhooks
schedule = "*/5 * * * *"

# Optional: number of concurrent runs allowed (default: 1)
# When scale > 1, use lock skills in your actions to coordinate
scale = 2

# Optional: max runtime in seconds (default: falls back to [local].timeout, then 900)
timeout = 600

# Optional: webhook triggers (instead of or in addition to schedule)
[[webhooks]]
source = "my-github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[[webhooks]]
source = "my-sentry"
resources = ["error", "event_alert"]

[[webhooks]]
source = "my-linear"
events = ["issues"]
actions = ["create", "update"]
labels = ["bug"]

[[webhooks]]
source = "my-mintlify"
events = ["build"]
actions = ["failed"]

# Optional: hooks — shell commands that run before or after the LLM session
[hooks]
pre = [
  "gh repo clone acme/app /tmp/repo --depth 1",
  "curl -o /tmp/flags.json https://api.internal/v1/flags",
]
post = ["upload-artifacts.sh"]

# Optional: custom parameters injected into the agent prompt as <agent-config>
[params]
repos = ["acme/app", "acme/api"]
triggerLabel = "agent"
assignee = "bot-user"
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
```

### config.toml Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | No | Git URL or GitHub shorthand for `al update`. Set automatically by `al add`. |
| `models` | string[] | Yes | Named model references from `config.toml [models.*]`. First is primary; rest are fallbacks. |
| `credentials` | string[] | Yes | Credential refs: `"type"` for default instance, `"type:instance"` for named instance. |
| `schedule` | string | No* | Cron expression for polling |
| `scale` | number | No | Number of concurrent runs allowed (default: 1). Set to `0` to disable the agent. |
| `timeout` | number | No | Max runtime in seconds. Falls back to `[local].timeout` in project config, then `900`. |
| `webhooks` | array | No* | Array of webhook trigger objects. |
| `hooks` | table | No | Pre/post hooks that run around the LLM session. |
| `params` | table | No | Custom key-value params injected into the prompt as `<agent-config>` |

*At least one of `schedule` or `webhooks` is required (unless `scale = 0`).

### Scale

Default: 1. Set 0 to disable. Busy: scheduled skipped, webhooks/calls queued.

### Timeout

Max runtime per invocation. Container terminated with exit 124 on expiry.

Resolves: agent -> project `[local].timeout` -> `900`.

### Hooks

Shell commands that run before and after the LLM session, inside the container.

**`hooks.pre`** — Run before context injection and LLM session. Use for cloning repos, fetching data, creating directories.

**`hooks.post`** — Run after LLM session completes. Use for cleanup, artifact upload, reporting.

Sequential execution. If a command fails (non-zero exit), the run aborts with error. Commands run via `/bin/sh -c "..."`.

```toml
[hooks]
pre = [
  "gh repo clone acme/app /tmp/repo --depth 1",
  "curl -o /tmp/flags.json https://api.internal/v1/flags",
]
post = ["upload-artifacts.sh"]
```

### Webhook Trigger Fields

Required `source` from `config.toml`. Filters optional (AND logic).

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

### Model Configuration

Optional. If defined, fully overrides project default (no merging).

## Credentials

Path: `~/.action-llama/credentials/<type>/<instance>/<field>`.

**Agents MUST NEVER ask for credentials or run `al doctor`. Missing = report and stop.**

### How credentials work

List in `agents/<name>/config.toml` credentials field. Mounted at `/credentials/...`, key values as env vars. `git_ssh` sets `GIT_AUTHOR_*`/`GIT_COMMITTER_*`. LLM creds auto-loaded from `[models.*]`.

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

Gateway only — not in agent containers.

### Infrastructure credentials

CLI only (provisioning, deployment).

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

8 providers. Define named models in `config.toml [models.*]`, reference by name in agent SKILL.md.

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

Non-Anthropic providers ignore `thinkingLevel`.

## Webhooks

Webhook triggers for agents.

### Runtime flow

POST `/webhooks/<type>` -> verify -> match triggers (AND) -> trigger agent. Busy: queued.

## Agent Commands

At `/app/bin/` (in `PATH`). Skill blocks teach usage.

### Signal commands

Write signal files for scheduler.

#### `al-rerun`

Request immediate rerun to drain backlog.

```bash
al-rerun
```

Scheduled only. Until no `al-rerun`, error, or `maxReruns` (10).

#### `al-status "<text>"`

Update status text in TUI/dashboard.

```bash
al-status "reviewing PR #42"
al-status "found 3 issues to work on"
```

#### `al-return "<value>"`

Return a value to the calling agent (when invoked via `al-subagent`).

```bash
al-return "PR looks good. Approved with minor suggestions."
al-return '{"approved": true, "comments": 2}'
```

For multiline, pipe via stdin:

```bash
echo "Line 1\nLine 2" | al-return
```

#### `al-exit [code]`

Terminate with exit code (default: 15).

```bash
al-exit          # exit code 15
al-exit 1        # exit code 1
```

Codes: 10=auth, 11=perm, 12=rate, 13=config, 14=dep, 15=unrecoverable, 16=abort.

### Call commands

Require gateway.

#### `al-subagent <agent>`

Call another agent. Pass context via stdin.

```bash
echo "Review PR #42 on acme/app" | al-subagent reviewer
```

```json
{"ok": true, "callId": "abc123"}
{"ok": false, "error": "self-call not allowed"}
{"ok": false, "error": "queue full"}
```

#### `al-subagent-check <callId>`

Non-blocking status check.

```bash
al-subagent-check abc123
```

```json
{"status": "pending"}
{"status": "completed", "returnValue": "PR approved."}
{"status": "error", "error": "timeout"}
```

#### `al-subagent-wait <callId> [...] [--timeout N]`

Wait for calls. Polls every 5s. Default timeout: 900s.

```bash
al-subagent-wait abc123 --timeout 600
al-subagent-wait abc123 def456 --timeout 300
```

```json
{
  "abc123": {"status": "completed", "returnValue": "PR approved."},
  "def456": {"status": "completed", "returnValue": "Tests pass."}
}
```

#### Complete call example

```bash
# Fire multiple calls
REVIEW_ID=$(echo "Review PR #42 on acme/app" | al-subagent reviewer | jq -r .callId)
TEST_ID=$(echo "Run full test suite for acme/app" | al-subagent tester | jq -r .callId)

# ... do other work ...

# Collect results
RESULTS=$(al-subagent-wait "$REVIEW_ID" "$TEST_ID" --timeout 600)
echo "$RESULTS" | jq ".\"$REVIEW_ID\".returnValue"
echo "$RESULTS" | jq ".\"$TEST_ID\".returnValue"
```

#### Call rules

No self-calls. Chains up to `maxCallDepth` (3). Use `al-return` to respond.

### Lock commands

Prevent duplicate work across instances.

#### `rlock`

Acquire exclusive lock.

```bash
rlock "github://acme/app/issues/42"
```

Responses:

```json
{"ok": true}
{"ok": false, "holder": "dev-abc123", "heldSince": "2025-01-15T10:30:00Z"}
{"ok": false, "reason": "already holding lock on ..."}
{"ok": false, "reason": "possible deadlock detected", "cycle": ["dev-abc", "github://acme/app/issues/10", "dev-def", "file:///deployments/api-prod"]}
```

#### `runlock`

Release a lock (holder only).

```bash
runlock "github://acme/app/issues/42"
```

```json
{"ok": true}
{"ok": false, "reason": "not the lock holder"}
```

#### `rlock-heartbeat`

Reset TTL on held lock during long work.

```bash
rlock-heartbeat "github://acme/app/issues/42"
```

```json
{"ok": true, "expiresAt": "2025-01-15T11:00:00Z"}
```

#### Lock behavior

Per-run secret auth. Auto-release on exit. **One at a time**. Expire after `resourceLockTimeout` (1800s).

#### Lock graceful degradation

No gateway: locks degrade gracefully (exit 0). Calls exit 5.

## CLI Commands

### `al new <name>` — Create project

### `al doctor` — Check/prompt for missing credentials. `-E` pushes to server.

### `al run <agent>` — Single run for testing (`-H` headless)

### `al start` — Start scheduler (`-w` dashboard, `-e` expose, `-H` headless, `--port <N>`)

### `al stop` — Stop scheduler (in-flight runs finish)

### `al stat` — Agent status overview

### `al logs <agent>` — View logs (`-n`, `-f`, `-d`, `-r`, `-i`)

### `al pause/resume [name]` — Pause/resume scheduler or agent

### `al kill <target>` — Kill agent or instance

### `al chat [agent]` — Interactive console (with agent: credentials injected)

### `al push [agent]` — Deploy via SSH (full or hot-reload single agent)

`--dry-run`, `--no-creds`, `--creds-only`, `--files-only`, `-a`, `--force-install`.

### Environment commands

#### `al env init <name>` — Create at `~/.action-llama/environments/<name>.toml`

#### `al env list` / `al env show <name>` — List or show environments

#### `al env set [name]` — Bind/unbind project to environment (`.env.toml`)

#### `al env check <name>` — Verify SSH, Docker, server readiness

#### `al env prov [name]` — Provision VPS (Vultr/Hetzner)

#### `al env deprov <name>` — Tear down environment

#### `al env logs [name]` — Server logs via SSH (`-n`, `-f`)

### Credential commands

#### `al creds ls` — List credentials (names, not values)

#### `al creds add <ref>` — Add/update (`github_token` or `git_ssh:prod`)

#### `al creds rm <ref>` — Remove credential

#### `al creds types` — Browse credential types

### Agent commands

#### `al agent new` — Create from template (dev, reviewer, devops, custom)

#### `al agent config <name>` — Configure agent interactively

### Global options

`-p <dir>` (project, default `.`) and `-E <name>` (env, also `AL_ENV` or `.env.toml`).

## Docker

### Image build order

```
al-agent:latest            ← Action Llama package (automatic, built on first run)
    ↓
al-project-base:latest     ← project Dockerfile (skipped if unmodified from bare FROM)
    ↓
al-<agent>:latest          ← per-agent Dockerfile (if present)
```

Bare project Dockerfile skips middle layer.

### Base image contents

Built from `node:20-alpine`:

| Package | Purpose |
|---------|---------|
| `node:20-alpine` | Container entry point, pi-coding-agent SDK |
| `git` | Clone repos, create branches, push commits |
| `curl` | API calls (Sentry, arbitrary HTTP), anti-exfiltration shutdown |
| `jq` | JSON processing in bash |
| `ca-certificates` | HTTPS for git, curl, npm |
| `openssh-client` | SSH for `GIT_SSH_COMMAND` — git clone/push over SSH |

Entry: `node /app/dist/agents/container-entry.js`. Commands at `/app/bin/`.

### Dockerfile conventions

`FROM al-agent:latest` (auto-rewritten). Images: `al-<name>:latest`.

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

Needs Node.js 20+, entry.js, `USER node`.

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache git curl ca-certificates openssh-client github-cli jq python3

COPY --from=al-agent:latest /app /app
WORKDIR /app

USER node
ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
```

Reads `AGENT_CONFIG`, `PROMPT`, `GATEWAY_URL` from env.

### Container filesystem

Read-only root, non-root user, resource limits.

| Path | Mode | Contents |
|------|------|----------|
| `/app` | read-only | Action Llama application + node_modules |
| `/app/static` | read-only | Agent files baked at build time (SKILL.md, agent-config.json, prompt skeleton) |
| `/app/bin` | read-only | Shell commands (al-rerun, al-status, rlock, etc.) — added to PATH at startup |
| `/credentials` | read-only | Mounted credential files (`/<type>/<instance>/<field>`) |
| `/tmp` | read-write (tmpfs, 2GB) | Agent working directory — repos, scratch files, SSH keys |
| `/workspace` | read-write (2GB) | Persistent workspace |
| `/home/node` | read-write (64MB) | Home directory |

### Environment variable persistence

Use `setenv` to persist environment variables across bash commands:

```bash
setenv REPO "owner/repo"
setenv ISSUE_NUMBER 42
gh issue view $ISSUE_NUMBER --repo $REPO
```

See `[local]` in config.toml for Docker configuration options.

## Gateway API

Auto-starting HTTP server. Port: `[gateway].port`.

API key at `~/.action-llama/credentials/gateway_api_key/default/key`.

### Protected routes

| Route | Auth |
|-------|------|
| `/dashboard` and `/dashboard/*` | Required |
| `/control/*` | Required |
| `/locks/status` | Required |
| `/health` | None |
| `/webhooks/*` | None (HMAC validation per-source) |

### Control API

All `POST`, require auth.

**Scheduler:**

| Endpoint | Description |
|----------|-------------|
| `POST /control/pause` | Pause the scheduler (all cron jobs) |
| `POST /control/resume` | Resume the scheduler |

**Agents:**

| Endpoint | Description |
|----------|-------------|
| `POST /control/trigger/<name>` | Trigger an immediate agent run |
| `POST /control/agents/<name>/enable` | Enable a disabled agent |
| `POST /control/agents/<name>/disable` | Disable an agent (pauses its cron job) |
| `POST /control/agents/<name>/pause` | Pause an agent (alias for disable) |
| `POST /control/agents/<name>/resume` | Resume an agent (alias for enable) |
| `POST /control/agents/<name>/kill` | Kill all running instances of an agent |

### SSE Streams

Live updates via **SSE**:

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

Enable with `al start -w`. URL: `http://localhost:<port>/dashboard`. Login with gateway API key.

### `/dashboard`

| Column | Description |
|--------|-------------|
| Agent | Agent name (click to view logs) |
| State | Current state: idle, running, building, or error |
| Status | Latest status text or error message |
| Last Run | Timestamp of the most recent run |
| Duration | How long the last run took |
| Next Run | When the next scheduled run will happen |
| Actions | **Run** (trigger an immediate run) and **Enable/Disable** (toggle the agent) |

Pause/Resume, Recent Activity. SSE updates.

### `/dashboard/agents/<name>/logs` — Live streaming agent logs

## Environments

Three-layer config merge (later wins):

| Layer | File | Scope | Contents |
|-------|------|-------|----------|
| 1 | `config.toml` | Project (committed) | `[models.*]`, `[local]`, `[gateway]`, `[webhooks]`, `[telemetry]`, top-level scheduler fields |
| 2 | `.env.toml` | Project (gitignored) | `environment` field to select env, can override any config value |
| 3 | `~/.action-llama/environments/<name>.toml` | Machine | `[server]` (SSH push deploy), `gateway.url`, `telemetry.endpoint` |

`[cloud]`/`[server]` must be Layer 3. Mutually exclusive.

Priority: `-E` flag > `AL_ENV` env var > `.env.toml`. Type: `server`.

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

Credentials synced via SSH.

## Running Agents

`al start` runs all agents. No per-agent start.

### Automatic re-runs

`al-rerun` triggers re-run until done/error/`maxReruns`. Webhook/call runs don't re-run.

## Exit Codes

### Shell command exit codes

**Always check exit codes.**

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
| 8 | Timeout | — | `al-subagent-wait` only: polling deadline exceeded |
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

Timeout: exit 124.
