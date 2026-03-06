import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { writeCredentialField, writeCredentialFields } from "../shared/credentials.js";

export { writeCredentialField, writeCredentialFields };

const PROJECT_AGENTS_MD = `# Action Llama Project

This is an Action Llama project. It runs automated development agents triggered by cron schedules or webhooks.

## Project Structure

Each agent is a directory containing:

- \`agent-config.toml\` — credentials, repos, model, schedule, webhooks, params
- \`PLAYBOOK.md\` — the system prompt (playbook) that defines what the agent does
- \`Dockerfile\` (optional) — custom Docker image extending the base \`al-agent:latest\` (e.g. to install extra tools like \`gh\`)

## Creating an Agent

1. Create a directory for your agent (e.g. \`my-agent/\`)
2. Add \`agent-config.toml\` with credentials, repos, model config, and a schedule or webhook trigger
3. Add \`PLAYBOOK.md\` with the playbook — step-by-step instructions the LLM follows each run
4. If running in Docker mode and your agent needs tools beyond what the base image provides (git, curl, openssh-client, node), add a \`Dockerfile\` — see Docker Mode section below
5. Verify with \`npx al status\`
6. Run with \`npx al start\`

## Credential Reference

Credentials are managed by the user via \`al setup\` and stored in \`~/.action-llama-credentials/<type>/<instance>/<field>\`. Reference them in \`credentials\` arrays as \`"type:instance"\` (e.g. \`"github_token:default"\`). The \`:default\` instance suffix can be omitted.

| Type | What it is | Fields | Runtime injection | What it enables |
|------|-----------|--------|-------------------|----------------|
| \`anthropic_key\` | Anthropic API key or OAuth token | \`token\` | Read directly by the agent SDK (not an env var) | LLM access — required for all agents |
| \`github_token\` | GitHub PAT (repo + workflow scopes) | \`token\` | \`GITHUB_TOKEN\` and \`GH_TOKEN\` env vars | \`gh\` CLI, \`git\` over HTTPS, GitHub API |
| \`git_ssh\` | SSH private key + git identity | \`id_rsa\`, \`username\`, \`email\` | SSH key mounted as file; \`GIT_SSH_COMMAND\` configured automatically; \`GIT_AUTHOR_NAME\`/\`GIT_AUTHOR_EMAIL\`/\`GIT_COMMITTER_NAME\`/\`GIT_COMMITTER_EMAIL\` set from \`username\`/\`email\` | \`git clone\`/\`push\` over SSH — **required for pushing to repos** |
| \`aws_credentials\` | AWS access credentials and default region | \`access_key_id\`, \`secret_access_key\`, \`default_region\` | \`AWS_ACCESS_KEY_ID\`, \`AWS_SECRET_ACCESS_KEY\`, \`AWS_DEFAULT_REGION\` env vars | AWS CLI, AWS SDKs via standard env vars |
| \`sentry_token\` | Sentry auth token | \`token\` | \`SENTRY_AUTH_TOKEN\` env var | Sentry API via \`curl\` |
| \`github_webhook_secret\` | Shared HMAC secret | \`secret\` | Used by gateway only (not injected into agents) | Validates GitHub webhook payloads |
| \`sentry_client_secret\` | Sentry client secret | \`secret\` | Used by gateway only (not injected into agents) | Validates Sentry webhook payloads |

**IMPORTANT:** Agents MUST NEVER ask users for credentials directly (API keys, tokens, passwords, etc.). Agents MUST NEVER run \`al setup\` or interact with the credential system on behalf of the user. If a credential is missing at runtime, the agent should report the error and stop — the user will run \`al setup\` and \`al start\` themselves.

## Runtime Context

Every agent prompt has these XML blocks injected automatically at runtime:

### \`<agent-config>\`

JSON object containing the agent's \`repos\` array and any custom \`[params]\` from \`agent-config.toml\`. Example:

\`\`\`json
{"repos":["acme/app"],"triggerLabel":"agent","assignee":"bot-user"}
\`\`\`

### \`<credential-context>\`

Lists which env vars and tools are available based on the agent's \`credentials\` array. Includes anti-exfiltration policy. The agent can rely on env vars like \`GITHUB_TOKEN\`, \`GH_TOKEN\`, \`SENTRY_AUTH_TOKEN\` being already set — it does NOT need to set them.

### \`<webhook-trigger>\` (webhook runs only)

JSON object with the webhook event details. Only present when the agent is triggered by a webhook (not on scheduled runs). Schema:

\`\`\`json
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
\`\`\`

## Webhook Reference

### How webhooks work

1. The gateway receives an HTTP POST from GitHub or Sentry at \`/webhooks/github\` or \`/webhooks/sentry\`
2. The payload is validated using secrets loaded from the named credential instance (e.g. HMAC-SHA256 for GitHub using \`github_webhook_secret\`, client secret for Sentry using \`sentry_client_secret\`)
3. The gateway matches the event against all agents' \`[[webhooks]]\` entries (AND logic — all specified fields must match; omitted fields are not checked)
4. Matching agents are triggered with a \`<webhook-trigger>\` block injected into their prompt

### GitHub webhook fields

| Field | Type | Description |
|-------|------|-------------|
| \`type\` | string | Provider type — must be \`"github"\` (required) |
| \`source\` | string | Credential instance name (optional, e.g. \`"MyOrg"\`) |
| \`repos\` | string[] | Filter to specific repos (owner/repo format) |
| \`events\` | string[] | Event types: \`issues\`, \`pull_request\`, \`push\`, \`issue_comment\`, etc. |
| \`actions\` | string[] | Event actions: \`opened\`, \`labeled\`, \`closed\`, \`synchronize\`, etc. |
| \`labels\` | string[] | Only trigger when the issue/PR has ALL of these labels |
| \`assignee\` | string | Only trigger when assigned to this user |
| \`author\` | string | Only trigger for events by this author |
| \`branches\` | string[] | Only trigger for pushes/PRs on these branches |

### Sentry webhook fields

| Field | Type | Description |
|-------|------|-------------|
| \`type\` | string | Provider type — must be \`"sentry"\` (required) |
| \`source\` | string | Credential instance name (optional) |
| \`resources\` | string[] | Resource types: \`error\`, \`event_alert\`, \`metric_alert\`, \`issue\`, \`comment\` |

### GitHub webhook setup

In your GitHub repo settings, add a webhook:
- **Payload URL:** \`http://<your-host>:8080/webhooks/github\`
- **Content type:** \`application/json\`
- **Secret:** the same secret stored as the \`github_webhook_secret\` credential

### TOML syntax for webhooks

Each webhook is a separate \`[[webhooks]]\` block (double brackets = array of tables):

\`\`\`toml
# Each [[webhooks]] is a separate array entry
[[webhooks]]
type = "github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[[webhooks]]
type = "github"
source = "MyOrg"          # optional — credential instance name
repos = ["my-org/other-repo"]
events = ["pull_request"]

[[webhooks]]
type = "sentry"
resources = ["error", "event_alert"]
\`\`\`

\`type\` is the provider type (required). \`source\` is the credential instance name (optional — defaults to \`"default"\`).

## \`agent-config.toml\` Complete Reference

The config file uses TOML syntax. The agent name is derived from the directory name — do not include it in the config.

### Minimal example (schedule only)

\`\`\`toml
credentials = ["github_token:default", "git_ssh:default"]
repos = ["your-org/your-repo"]
schedule = "*/5 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"
\`\`\`

### Full example (schedule + webhooks + params)

\`\`\`toml
credentials = ["github_token:default", "git_ssh:default", "sentry_token:default"]
repos = ["acme/app", "acme/api"]
schedule = "*/5 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[[webhooks]]
type = "github"
repos = ["acme/app"]
events = ["issues"]
actions = ["labeled"]
labels = ["agent"]

[[webhooks]]
type = "sentry"
resources = ["error", "event_alert"]

[params]
triggerLabel = "agent"
assignee = "bot-user"
sentryOrg = "acme"
sentryProjects = ["web-app", "api"]
\`\`\`

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| \`credentials\` | string[] | Yes | Credential refs as \`"type:instance"\` (see Credential Reference above) |
| \`repos\` | string[] | Yes | GitHub repos in owner/repo format |
| \`schedule\` | string | No* | Cron expression (e.g. "*/5 * * * *") |
| \`model.provider\` | string | Yes | Always "anthropic" |
| \`model.model\` | string | Yes | Model ID (e.g. "claude-sonnet-4-20250514") |
| \`model.thinkingLevel\` | string | Yes | off \\| minimal \\| low \\| medium \\| high \\| xhigh |
| \`model.authType\` | string | Yes | api_key \\| oauth_token |
| \`webhooks[].type\` | string | Yes | Provider type: "github" or "sentry" |
| \`webhooks[].source\` | string | No | Credential instance name (defaults to "default") |
| \`webhooks[].repos\` | string[] | No | Filter to specific repos |
| \`webhooks[].events\` | string[] | No | GitHub event types: issues, pull_request, push |
| \`webhooks[].actions\` | string[] | No | GitHub actions: opened, labeled, closed |
| \`webhooks[].labels\` | string[] | No | Only trigger for issues/PRs with these labels |
| \`webhooks[].resources\` | string[] | No | Sentry resources: error, event_alert, metric_alert, issue, comment |
| \`params.*\` | any | No | Custom key-value pairs injected into the prompt |

*At least one of \`schedule\` or \`webhooks\` is required.

### TOML syntax reminders

- Strings: \`key = "value"\`
- Arrays: \`key = ["a", "b"]\`
- Tables (objects): \`[tableName]\` on its own line, followed by key-value pairs
- Array of tables: \`[[arrayName]]\` on its own line — each block is one entry in the array
- Comments: \`# comment\`

## Example Playbook

**Agent playbooks must be detailed and prescriptive with step-by-step commands. Copy this example and customize rather than writing from scratch.**

The following is a complete, working PLAYBOOK.md for a developer agent. Use it as a template for all new agents:

\`\`\`markdown
# Developer Agent

You are a developer agent. Your job is to pick up GitHub issues and implement the requested changes.

Your configuration is in the \\\`<agent-config>\\\` block at the start of your prompt.
Use those values for repos, triggerLabel, and assignee.

\\\`GITHUB_TOKEN\\\` is already set in your environment. Use \\\`gh\\\` CLI and \\\`git\\\` directly.
(Note: \\\`gh\\\` is not in the base Docker image — this agent needs a custom Dockerfile that installs it. See Docker Mode section.)

**You MUST complete ALL steps below.** Do not stop after reading the issue — you must implement, commit, push, and open a PR.

## Finding work

**Webhook trigger:** When you receive a \\\`<webhook-trigger>\\\` block, the issue details are already in the trigger context. Check the issue's labels and assignee against your \\\`triggerLabel\\\` and \\\`assignee\\\` params. If the issue matches (has your trigger label and is assigned to your assignee), proceed with implementation. If it does not match, respond \\\`[SILENT]\\\` and stop.

**Scheduled trigger:** Run \\\`gh issue list --repo <repo> --label <triggerLabel> --assignee <assignee> --state open --json number,title,body,comments,labels --limit 1\\\`. If empty, respond \\\`[SILENT]\\\` and stop.

## Workflow

1. **Claim the issue** — run \\\`gh issue edit <number> --repo <repo> --add-label in-progress\\\` to mark it as claimed.

2. **Clone and branch** — run \\\`git clone git@github.com:<repo>.git /workspace/repo && cd /workspace/repo && git checkout -b agent/<number>\\\`.

3. **Understand the issue** — read the title, body, and comments. Note file paths, acceptance criteria, and linked issues.

4. **Read project conventions** — in the repo, read \\\`PLAYBOOK.md\\\`, \\\`CLAUDE.md\\\`, \\\`CONTRIBUTING.md\\\`, and \\\`README.md\\\` if they exist. Follow any conventions found there.

5. **Implement changes** — work in the repo. Make the minimum necessary changes, follow existing patterns, and write or update tests if the project has a test suite.

6. **Validate** — run the project's test suite and linters (e.g., \\\`npm test\\\`). Fix failures before proceeding.

7. **Commit** — \\\`git add -A && git commit -m "fix: <description> (closes #<number>)"\\\`

8. **Push** — \\\`git push -u origin agent/<number>\\\`

9. **Create a PR** — run \\\`gh pr create --repo <repo> --head agent/<number> --base main --title "<title>" --body "Closes #<number>\\\\n\\\\n<description>"\\\`.

10. **Comment on the issue** — run \\\`gh issue comment <number> --repo <repo> --body "PR created: <pr_url>"\\\`.

11. **Mark done** — run \\\`gh issue edit <number> --repo <repo> --remove-label in-progress --add-label agent-completed\\\`.

## Rules

- Work on exactly ONE issue per run
- Never modify files outside the repo directory
- **You MUST complete steps 7-11.** Do not stop early.
- If tests fail after 2 attempts, create the PR anyway with a note about failing tests
- If the issue is unclear, comment asking for clarification and stop
\`\`\`

## Docker Mode

Enable Docker container isolation by adding \`[docker]\nenabled = true\` to your project's \`config.toml\`. Each agent run launches an isolated container with a read-only root filesystem, dropped capabilities, non-root user, and resource limits.

### Base image

The base image (\`al-agent:latest\`) is built automatically on first run. It includes Node.js, git, curl, openssh-client, and ca-certificates — the minimum needed for any agent.

### Custom agent images

If your agent needs extra tools (e.g. \`gh\` CLI, Python, \`jq\`), add a \`Dockerfile\` to the agent directory that extends the base image:

\`\`\`dockerfile
FROM al-agent:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*
USER node
\`\`\`

Agent images are built automatically on startup. If no \`Dockerfile\` is present, the agent uses the base image.

### Container filesystem

| Path | Mode | Contents |
|------|------|----------|
| \`/app\` | read-only | Action Llama application + node_modules |
| \`/credentials\` | read-only | Mounted credential files (\`/<type>/<instance>/<field>\`) |
| \`/workspace\` | read-write (tmpfs, 2GB) | Working directory — repos are cloned here |
| \`/tmp\` | read-write (tmpfs, 512MB) | Temporary files |
| \`/home/node\` | read-write (tmpfs, 64MB) | User home — \`.ssh/\` for SSH keys |

### Docker config options

| Key | Default | Description |
|-----|---------|-------------|
| \`docker.enabled\` | \`false\` | Enable Docker container isolation |
| \`docker.image\` | \`"al-agent:latest"\` | Base Docker image name |
| \`docker.memory\` | \`"4g"\` | Memory limit per container |
| \`docker.cpus\` | \`2\` | CPU limit per container |
| \`docker.timeout\` | \`3600\` | Max container runtime in seconds |

## Running Agents

Start all agents with \`al start\` (or \`npx al start\`). This starts the scheduler which runs all discovered agents on their configured schedules/webhooks. There is no per-agent start command — \`al start\` always starts the entire project.

## Further Documentation

Full documentation is available on GitHub:

- [Creating Agents](https://github.com/Action-Llama/action-llama/blob/main/docs/creating-agents.md)
- [agent-config.toml Reference](https://github.com/Action-Llama/action-llama/blob/main/docs/agent-config-reference.md)
- [Credentials](https://github.com/Action-Llama/action-llama/blob/main/docs/credentials.md)
- [Webhooks](https://github.com/Action-Llama/action-llama/blob/main/docs/webhooks.md)
- [Docker](https://github.com/Action-Llama/action-llama/blob/main/docs/docker.md) — custom Dockerfiles, standalone images, troubleshooting
- [CLI Commands](https://github.com/Action-Llama/action-llama/blob/main/docs/commands.md)
- [Example Agents](https://github.com/Action-Llama/action-llama/blob/main/docs/examples/dev-agent.md) — dev, reviewer, devops
`;

export interface ScaffoldAgent {
  name: string;
  config: AgentConfig;
}

export function scaffoldAgent(projectPath: string, agent: ScaffoldAgent): void {
  const agentPath = resolve(projectPath, agent.name);
  mkdirSync(agentPath, { recursive: true });

  // Strip `name` before serializing — it's derived from the directory name
  const { name: _, ...configToWrite } = agent.config;
  writeFileSync(
    resolve(agentPath, "agent-config.toml"),
    stringifyTOML(configToWrite as Record<string, unknown>) + "\n"
  );

  // Write a stub PLAYBOOK.md if none exists
  const playbookPath = resolve(agentPath, "PLAYBOOK.md");
  if (!existsSync(playbookPath)) {
    writeFileSync(playbookPath, `# ${agent.name} Agent\n\nCustom agent.\n`);
  }
}

export function scaffoldProject(
  projectPath: string,
  globalConfig: GlobalConfig,
  agents: ScaffoldAgent[] = [],
  projectName?: string
): void {
  mkdirSync(projectPath, { recursive: true });

  // Create package.json with @action-llama/action-llama dependency
  const pkgPath = resolve(projectPath, "package.json");
  if (!existsSync(pkgPath)) {
    const pkg = {
      name: projectName || "al-project",
      private: true,
      type: "module",
      dependencies: {
        "@action-llama/action-llama": "latest",
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Write global config only if non-empty
  if (Object.keys(globalConfig).length > 0) {
    writeFileSync(
      resolve(projectPath, "config.toml"),
      stringifyTOML(globalConfig as Record<string, unknown>) + "\n"
    );
  }

  for (const agent of agents) {
    scaffoldAgent(projectPath, agent);
  }

  // Write project-level AGENTS.md for coding agents
  const agentsMdPath = resolve(projectPath, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, PROJECT_AGENTS_MD);
  }

  // Create workspace directory
  mkdirSync(resolve(projectPath, ".workspace"), { recursive: true });

  // Create .gitignore
  const gitignorePath = resolve(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, [
      "node_modules/",
      ".workspace/",
      ".al/",
      "*.log",
      ".DS_Store",
      "",
    ].join("\n"));
  }
}
