import { resolve, join } from "path";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { loadCredentialField } from "../../shared/credentials.js";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

const AL_KEYBINDINGS = {
  newLine: ["shift+enter", "alt+enter"],
  followUp: [],
};

const NO_AGENTS_CONTEXT = `
## Console Mode — No Agents Yet

This project has no agents yet. The user has just opened the console to create their first agent.

Built-in agent templates:

1. **dev** — Developer agent that picks up GitHub issues labeled with a trigger label, implements the changes, and opens PRs. Needs: github_token:default, git_ssh:default. Config fields: repos, triggerLabel, assignee. Uses: \`gh\`, \`git\`, \`curl\`.
2. **reviewer** — PR reviewer agent that reviews open pull requests, approves good ones, and requests changes on problematic ones. Needs: github_token:default, git_ssh:default. Config fields: repos. Uses: \`gh\`, \`git\`, \`curl\`.
3. **devops** — DevOps monitoring agent that detects CI failures and Sentry errors, then files GitHub issues. Needs: github_token:default, git_ssh:default, sentry_token:default. Config fields: repos, sentryOrg, sentryProjects. Uses: \`git\`, \`curl\`.
4. **custom** — Start from scratch with a blank PLAYBOOK.md.

### Docker base image

When Docker mode is enabled, agents run in an isolated container. The base image (\`al-agent:latest\`) includes ONLY these tools: **Node.js, git, curl, openssh-client, ca-certificates**. Nothing else — no \`gh\`, no \`python3\`, no \`jq\`, no language runtimes beyond Node.

### When to create a custom Dockerfile

After writing the agent's PLAYBOOK.md, analyze it to determine what CLI tools, language runtimes, or system packages the agent will need at runtime. If ANY tool is required that is not in the base image (git, curl, openssh-client, node), you MUST create a \`Dockerfile\` in the agent directory.

Example — agent that needs \`gh\` CLI:

\`\`\`dockerfile
FROM al-agent:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*
USER node
\`\`\`

Example — agent that needs Python:

\`\`\`dockerfile
FROM al-agent:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*
USER node
\`\`\`

If the agent needs a fundamentally different base (e.g. a Python-heavy agent that should use \`python:3.12-slim\` instead of \`node:20-slim\`), you can use any base image — just make sure to install Node.js and set up the \`node\` user (uid 1000) since the container entry point requires them.

### Model configuration

The project's \`config.toml\` defines a default \`[model]\` that all agents inherit. Do NOT add a \`[model]\` section to an agent's \`agent-config.toml\` unless the user specifically wants that agent to use a different model or thinking level than the project default. Omitting \`[model]\` from the agent config is correct — it will inherit from the project.

### Credentials

The available credentials are listed below under "Available Credentials". Use these when writing the agent's \`credentials\` array in \`agent-config.toml\`. Reference them as \`"type:instance"\` (e.g. \`"github_token:default"\`). For default instances, you can omit the \`:default\` suffix.

When a credential type has **multiple instances** (e.g. \`github_webhook_secret:myapp\` and \`github_webhook_secret:staging\`), ask the user which instance they want to use for this agent. Do not guess.

If a required credential is missing from the available list, tell the user to run \`al doctor\` to set it up, then re-open the console.

When the user asks to create an agent:
- Ask which template they want and walk them through configuring it
- Check the available credentials and use what's there; ask the user to choose when there are multiple instances of a credential type
- Create the agent directory with \`agent-config.toml\`, \`PLAYBOOK.md\`, and a \`Dockerfile\` if the playbook requires tools not in the base image
- Do NOT include \`[model]\` in agent-config.toml unless the user asks for a different model than the project default
- **IMPORTANT:** Agent playbooks must be detailed and prescriptive with step-by-step commands. Copy the example playbook from the "Example Playbook" section above and customize it — do NOT write simplified or abbreviated instructions.
`;

const NO_AGENTS_INITIAL_MESSAGE = `Help me create my first agent.`;

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const agentsFile = resolve(projectPath, "AGENTS.md");
  const agentsContent = existsSync(agentsFile)
    ? readFileSync(agentsFile, "utf-8")
    : undefined;

  // Collect agent summaries for context
  const agents = discoverAgents(projectPath);
  const agentSummaries = agents.map((name) => {
    try {
      const config = loadAgentConfig(projectPath, name);
      return `- ${name}: schedule=${config.schedule || "webhook-only"}`;
    } catch {
      return `- ${name}: (could not load config)`;
    }
  });

  // Build initial message based on whether agents exist
  let initialMessage: string;
  if (agents.length === 0) {
    initialMessage = NO_AGENTS_INITIAL_MESSAGE;
  } else {
    const agentList = agentSummaries.map((s) => `  ${s}`).join("\n");
    initialMessage = `I have ${agents.length} agent${agents.length === 1 ? "" : "s"} configured:\n\n${agentList}\n\nWhat would you like to do? I can help you create a new agent, edit an existing agent's config or prompt, or troubleshoot issues.`;
  }

  // Suppress pi-coding-agent's "Update Available" banner — not relevant to al console users
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // Ensure keybindings.json exists with our defaults (Option+Enter = new line)
  ensureKeybindings();

  // Read effective keybindings to display accurate shortcuts
  const keybindings = readKeybindings();
  const fmt = (keys: string | string[]) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr
      .filter((k) => k)
      .map((k) =>
        k
          .split("+")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join("+")
      )
      .join(" / ");
  };
  const submitKeys = keybindings.submit || "enter";
  const newLineKeys = keybindings.newLine || "shift+enter";
  const shortcuts = [
    `${fmt(submitKeys)} = send`,
    `${fmt(newLineKeys)} = new line`,
    `Ctrl+C = cancel`,
    `Ctrl+D = exit`,
  ];
  console.log(`Shortcuts: ${shortcuts.join(", ")}\n`);

  const {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    createCodingTools,
    InteractiveMode,
  } = await import("@mariozechner/pi-coding-agent");
  const { getModel } = await import("@mariozechner/pi-ai");

  const globalConfig = loadGlobalConfig(projectPath);
  const modelConfig = globalConfig.model || {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "medium" as const,
    authType: "api_key" as const,
  };

  const authStorage = AuthStorage.create();
  if (modelConfig.authType !== "pi_auth") {
    if (modelConfig.provider === "anthropic") {
      const credential = loadCredentialField("anthropic_key", "default", "token");
      if (credential) {
        authStorage.setRuntimeApiKey("anthropic", credential);
      }
    } else if (modelConfig.provider === "openai") {
      const credential = loadCredentialField("openai_key", "default", "token");
      if (credential) {
        authStorage.setRuntimeApiKey("openai", credential);
      }
    }
  }

  const model = getModel(modelConfig.provider as any, modelConfig.model as any);

  // Load AGENTS.md context, appending agent summaries or no-agents guidance
  let fullContext = agentsContent || "";
  if (agents.length === 0) {
    fullContext += NO_AGENTS_CONTEXT;
  } else if (agentSummaries.length > 0) {
    fullContext += `\n\n## Current Agents\n\n${agentSummaries.join("\n")}`;
  }

  // Append available credentials
  const credInventory = collectCredentialInventory();
  if (credInventory) {
    fullContext += `\n\n## Available Credentials\n\nThese credentials are configured locally (from \`al creds ls\`):\n\n${credInventory}\n`;
  } else {
    fullContext += `\n\n## Available Credentials\n\nNo credentials configured yet. The user should run \`al doctor\` to set them up.\n`;
  }

  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    ...(fullContext
      ? {
          agentsFilesOverride: () => ({
            agentsFiles: [{ path: agentsFile, content: fullContext }],
          }),
        }
      : {}),
  });
  await resourceLoader.reload();

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
    quietStartup: true,
    hideThinkingBlock: true,
  });

  const { session } = await createAgentSession({
    cwd: projectPath,
    model,
    thinkingLevel: modelConfig.thinkingLevel,
    authStorage,
    resourceLoader,
    tools: createCodingTools(projectPath),
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  const mode = new InteractiveMode(session, { initialMessage });
  await mode.run();
}

function keybindingsPath(): string {
  return join(homedir(), ".pi", "agent", "keybindings.json");
}

function ensureKeybindings(): void {
  const filePath = keybindingsPath();
  if (existsSync(filePath)) return;

  const dir = join(homedir(), ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(AL_KEYBINDINGS, null, 2) + "\n");
}

function readKeybindings(): Record<string, string | string[]> {
  const filePath = keybindingsPath();
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Collect a credential inventory: type → instance[] → field[]
 * Returns a formatted string like `al creds ls` output, or empty string if none.
 */
function collectCredentialInventory(): string {
  let types: string[];
  try {
    types = readdirSync(CREDENTIALS_DIR).filter((e) => {
      try { return statSync(resolve(CREDENTIALS_DIR, e)).isDirectory(); } catch { return false; }
    }).sort();
  } catch {
    return "";
  }

  const lines: string[] = [];
  for (const type of types) {
    const typeDir = resolve(CREDENTIALS_DIR, type);
    let instances: string[];
    try {
      instances = readdirSync(typeDir).filter((e) => {
        try { return statSync(resolve(typeDir, e)).isDirectory(); } catch { return false; }
      }).sort();
    } catch {
      continue;
    }

    for (const instance of instances) {
      const instanceDir = resolve(typeDir, instance);
      let fields: string[];
      try {
        fields = readdirSync(instanceDir).filter((e) => {
          try { return statSync(resolve(instanceDir, e)).isFile(); } catch { return false; }
        }).sort();
      } catch {
        fields = [];
      }
      if (fields.length === 0) continue;

      const ref = instance === "default" ? type : `${type}:${instance}`;
      lines.push(`  ${ref}  (${fields.join(", ")})`);
    }
  }

  return lines.join("\n");
}
