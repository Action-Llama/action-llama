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
- Credential files in `~/.action-llama/credentials/`

After setup, create agents by following [Creating Agents](creating-agents.md).

## `al doctor`

Checks all agent credentials and interactively prompts for any that are missing. Discovers agents in the project, collects their credential requirements (plus any webhook secret credentials), and ensures each one exists on disk. Also generates a gateway API key if one doesn't exist yet (used for dashboard and CLI authentication).

Additionally validates webhook trigger field configurations to catch common errors like:
- Using `repository` instead of `repos`
- Misspelled field names
- Invalid field types

This helps catch configuration mistakes early and ensures webhook triggers are properly configured.

```bash
al doctor -p .
al doctor -p ./my-project
al doctor -c               # Also push creds to cloud + reconcile IAM
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Push credentials to cloud and create per-agent IAM resources |

### `al doctor -c`

In cloud mode, `al doctor` additionally:
1. Pushes all local credentials to the cloud secret manager configured in `[cloud]`
2. Creates per-agent IAM resources (service accounts for Cloud Run, task roles for ECS)
3. Grants each agent access to only its declared secrets

**Cloud Run** (`cloud.provider = "cloud-run"`):

For each agent, it:
1. Creates `al-{agentName}@{gcpProject}.iam.gserviceaccount.com`
2. Grants `secretmanager.secretAccessor` on that agent's declared credentials
3. Grants `iam.serviceAccountUser` for Cloud Run execution

Requires `gcloud` CLI with project admin permissions. See [Cloud Run docs](cloud-run.md) for full setup.

**ECS Fargate** (`cloud.provider = "ecs"`):

For each agent, it:
1. Creates IAM role `al-{agentName}-task-role`
2. Attaches an inline policy granting `secretsmanager:GetSecretValue` on that agent's declared credentials

Requires AWS CLI with IAM admin permissions. See [ECS docs](ecs.md) for full setup.

**Re-run after adding agents:** Whenever you add a new agent to your project, re-run `al doctor -c` to create IAM resources for the new agent. Without this, the new agent won't have access to its credentials at runtime.

## `al creds ls`

Lists all stored credentials grouped by type, showing field names but not values.

```bash
al creds ls
```

Example output:

```
  Anthropic API Key (anthropic_key)
    anthropic_key  (token)

  GitHub Token (github_token)
    github_token  (token)

  GitHub Webhook Secret (github_webhook_secret)
    github_webhook_secret:myapp  (secret)
    github_webhook_secret:staging  (secret)
```

Default instances are shown without the `:default` suffix.

## `al creds add <ref>`

Add or update a credential. Runs the interactive prompter with validation for the credential type.

```bash
al creds add github_token              # adds github_token:default
al creds add github_webhook_secret:myapp
al creds add git_ssh:prod
```

The `<ref>` format is `type` or `type:instance`. If no instance is specified, defaults to `default`. If the credential already exists, you'll be prompted to update it.

## `al creds rm <ref>`

Remove a credential from disk.

```bash
al creds rm github_token               # removes github_token:default
al creds rm github_webhook_secret:myapp
```

Removes all field files for the credential instance. If the type directory becomes empty, it is also removed.

## `al setup cloud`

Interactive wizard for configuring cloud infrastructure. Prompts for provider selection and provider-specific fields, writes `[cloud]` to config.toml, pushes credentials, and provisions IAM — all in one shot.

If an existing `[cloud]` config is found, you'll be prompted to tear down the old infrastructure first.

```bash
al setup cloud -p .
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al teardown cloud`

Deletes per-agent IAM resources (service accounts for Cloud Run, task roles for ECS) and removes the `[cloud]` section from config.toml.

```bash
al teardown cloud -p .
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |

## `al run <agent>`

Manually triggers a single agent run. The agent runs once and the process exits when it completes. Useful for testing, debugging, or one-off runs without starting the full scheduler.

```bash
al run dev -p .
al run reviewer -p ./my-project
al run dev -c                 # Run on cloud
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Run on cloud infrastructure |

## `al start`

Starts the scheduler. Runs all agents on their configured schedules and listens for webhooks.

```bash
al start -p .
al start -p ./my-project
al start -c                   # Run on cloud
al start -w                   # Enable web dashboard
al start -e -g                # VPS deployment: expose gateway publicly
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Run on cloud infrastructure |
| `-w, --web-ui` | Enable web dashboard (see [Web Dashboard](web-dashboard.md)) |
| `-e, --expose` | Bind gateway to `0.0.0.0` (public) while keeping local-mode features |
| `-g, --gateway` | Enable HTTP gateway server (required for webhooks and `--expose`) |
| `-H, --headless` | Non-interactive mode (no TUI, no credential prompts) |

## `al stat`

Shows status of all discovered agents in the project.

```bash
al stat -p .
al stat -c                    # Show cloud status
```

Displays each agent's schedule, credentials, and webhook configuration.

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Show cloud infrastructure status |

## `al logs <agent>`

View log files for a specific agent.

```bash
al logs dev -p .
al logs dev -n 100          # Show last 100 entries
al logs dev -f              # Follow/tail mode
al logs dev -d 2025-01-15   # Specific date
al logs dev -c              # Cloud logs
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-n, --lines <N>` | Number of log entries (default: 50) |
| `-f, --follow` | Tail mode — watch for new entries |
| `-d, --date <YYYY-MM-DD>` | View a specific date's log file |
| `-c, --cloud` | View cloud logs (Cloud Logging / CloudWatch) |

## `al pause [name]`

Pause the scheduler or a single agent. Without a name, pauses the entire scheduler — all cron jobs stop firing. With a name, pauses that agent — its cron job stops firing and webhook events are ignored. In-flight runs continue until they finish. Requires the gateway.

```bash
al pause                              # Pause the scheduler
al pause dev                          # Pause a single agent
al pause reviewer -p ./my-project
al pause dev -c                       # Pause via cloud gateway
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Forward pause request to the cloud-deployed scheduler's gateway |

## `al resume [name]`

Resume the scheduler or a single agent. Without a name, resumes the entire scheduler. With a name, resumes that agent — its cron job resumes firing and webhooks are accepted again.

```bash
al resume                             # Resume the scheduler
al resume dev                         # Resume a single agent
al resume reviewer -p ./my-project
al resume dev -c                      # Resume via cloud gateway
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Forward resume request to the cloud-deployed scheduler's gateway |

## `al kill <target>`

Kill an agent (all running instances) or a single instance by ID. Tries the target as an agent name first; if not found, falls back to instance ID. This does **not** pause the agent — if it has a schedule, a new run will start at the next cron tick. To fully stop an agent, pause it first, then kill.

```bash
al kill dev                           # Kill all instances of an agent
al kill my-agent-abc123               # Kill a single instance by ID
al kill dev -p ./my-project
al kill dev -c                        # Kill cloud tasks directly
```

| Option | Description |
|--------|-------------|
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Kill cloud tasks directly via ECS StopTask / Cloud Run cancel APIs |

## `al chat`

Open an interactive console. Without an agent name, opens the project-level console for creating and managing agents. With an agent name, opens an interactive session scoped to that agent's environment — credentials are loaded and injected as environment variables (e.g. `GITHUB_TOKEN`, `GIT_SSH_COMMAND`), and the working directory is set to the agent's directory.

```bash
al chat                # project-level console
al chat dev            # interactive session with dev agent's credentials
al chat dev -c         # same, but credentials from cloud secrets manager
```

| Option | Description |
|--------|-------------|
| `[agent]` | Agent name — loads its credentials and environment |
| `-p, --project <dir>` | Project directory (default: `.`) |
| `-c, --cloud` | Load credentials from cloud secrets manager |

When running in agent mode, the command probes the gateway and warns if it is not reachable:

```
⚠ No gateway detected at http://localhost:8080. Resource locks, agent calls, and signals are unavailable.
  Start the scheduler with `al start -g` to enable these features.
```

The agent's ACTIONS.md is loaded as reference context but is **not** auto-executed — you drive the session interactively.
