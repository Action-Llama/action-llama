import { resolve, join } from "path";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir, homedir } from "os";
import { fileURLToPath } from "url";
import { loadCredentialField, loadCredentialFields, parseCredentialRef } from "../../shared/credentials.js";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { builtinCredentials } from "../../credentials/builtins/index.js";

function resolvePackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return resolve(thisFile, "..", "..", "..", "..");
}

function loadExampleTemplate(agentType: string): { skill: string } | undefined {
  const dir = resolve(resolvePackageRoot(), "docs", "examples", agentType);
  const skillPath = resolve(dir, "SKILL.md");
  if (!existsSync(skillPath)) return undefined;
  return {
    skill: readFileSync(skillPath, "utf-8"),
  };
}

const AL_KEYBINDINGS = {
  newLine: ["shift+enter", "alt+enter"],
  followUp: [],
};

function buildNoAgentsContext(): string {
  const templates = ["dev", "reviewer", "devops"];
  const templateSections: string[] = [];

  for (const name of templates) {
    const tpl = loadExampleTemplate(name);
    if (!tpl) continue;
    templateSections.push(
      `### Template: ${name}\n\n` +
      `#### SKILL.md\n\n\`\`\`markdown\n${tpl.skill.trim()}\n\`\`\``
    );
  }

  return `
## Console Mode — No Agents Yet

This project has no agents yet. The user has just opened the console to create their first agent.

### Available templates

1. **dev** — Picks up GitHub issues labeled with a trigger label, implements the changes, and opens PRs
2. **reviewer** — Reviews open pull requests, approves good ones, and requests changes on problematic ones
3. **devops** — Monitors CI/CD failures and Sentry errors, then files deduplicated GitHub issues
4. **custom** — Start from scratch with a blank SKILL.md

### Creating an agent

When the user picks a template:

1. **Ask what they need** — which template, which repos, any customization
2. **Create the agent directory** (\`agents/<name>/\`)
3. **Write SKILL.md** — a single file with YAML frontmatter (config) and markdown body (instructions). Use the template below as a starting point. Customize the frontmatter \`params\` based on the user's answers (repos, triggerLabel, assignee, etc.). Do NOT include a \`model\` field unless the user specifically asks for a different model — agents inherit the project default from \`config.toml\`.
4. **Create a Dockerfile if needed** — analyze the SKILL.md to determine what CLI tools the agent needs. The base image (\`al-agent\`) is Alpine-based (\`node:20-alpine\`) and includes: Node.js, git, curl, jq, openssh-client, ca-certificates. If the agent needs anything else (e.g. \`gh\` CLI), create a Dockerfile:

\`\`\`dockerfile
FROM al-agent
USER root
RUN apk add --no-cache github-cli
USER node
\`\`\`

5. **Tell the user to run \`al doctor\`** to set up any missing credentials. Do NOT check for credentials yourself or run any shell commands to verify them.

### Credentials in SKILL.md

Reference credentials by type name (e.g. \`"github_token"\`, \`"git_ssh"\`). The instance is resolved automatically at runtime. Do not worry about whether credentials exist yet — \`al doctor\` handles that.

${templateSections.join("\n\n")}
`;
}

const NO_AGENTS_INITIAL_MESSAGE = `Help me create my first agent.`;

export interface ChatOpts {
  project: string;
  agent?: string;
  env?: string;
}

export async function execute(opts: ChatOpts): Promise<void> {
  if (opts.agent) {
    await executeAgentChat(opts as ChatOpts & { agent: string });
  } else {
    await executeProjectChat(opts);
  }
}

// ---------------------------------------------------------------------------
// Agent-scoped chat: load agent credentials/environment, interactive session
// ---------------------------------------------------------------------------

async function executeAgentChat(opts: ChatOpts & { agent: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const agentName = opts.agent;
  const globalConfig = loadGlobalConfig(projectPath, opts.env);

  // Validate agent exists
  const agentNames = discoverAgents(projectPath);
  if (!agentNames.includes(agentName)) {
    const available = agentNames.length > 0 ? `Available agents: ${agentNames.join(", ")}` : "No agents found.";
    throw new Error(`Agent "${agentName}" not found. ${available}`);
  }

  const agentConfig = loadAgentConfig(projectPath, agentName);

  // Load and inject credentials as env vars (mirrors container-entry.ts)
  const injectedEnvVars: string[] = [];
  const cleanupPaths: string[] = [];

  for (const credRef of agentConfig.credentials) {
    const { type, instance } = parseCredentialRef(credRef);
    const fields = await loadCredentialFields(type, instance);
    if (!fields) continue;
    const def = builtinCredentials[type];
    if (!def?.envVars) continue;

    for (const [fieldName, envVar] of Object.entries(def.envVars)) {
      if (fields[fieldName]) {
        process.env[envVar] = fields[fieldName];
        injectedEnvVars.push(envVar);
      }
    }
    // Special case: github_token also sets GH_TOKEN alias
    if (type === "github_token" && fields.token) {
      process.env.GH_TOKEN = fields.token;
      injectedEnvVars.push("GH_TOKEN");
    }
  }

  // Configure git HTTPS credential helper
  if (process.env.GITHUB_TOKEN) {
    process.env.GIT_TERMINAL_PROMPT = "0";
    injectedEnvVars.push("GIT_TERMINAL_PROMPT");
    const idx = parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
    process.env.GIT_CONFIG_COUNT = String(idx + 1);
    process.env[`GIT_CONFIG_KEY_${idx}`] = "credential.helper";
    process.env[`GIT_CONFIG_VALUE_${idx}`] = `!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f`;
    injectedEnvVars.push("GIT_CONFIG_COUNT", `GIT_CONFIG_KEY_${idx}`, `GIT_CONFIG_VALUE_${idx}`);
  }

  // Set up SSH key for git if git_ssh credential exists
  const gitSshRef = agentConfig.credentials.find((ref) => parseCredentialRef(ref).type === "git_ssh");
  if (gitSshRef) {
    const { instance } = parseCredentialRef(gitSshRef);
    const sshKey = await loadCredentialField("git_ssh", instance, "id_rsa");
    if (sshKey) {
      const sshDir = resolve(tmpdir(), `al-chat-ssh-${process.pid}`);
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      const keyPath = resolve(sshDir, "id_rsa");
      writeFileSync(keyPath, sshKey + "\n", { mode: 0o600 });
      process.env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`;
      injectedEnvVars.push("GIT_SSH_COMMAND");
      cleanupPaths.push(sshDir);
    }

    const gitName = await loadCredentialField("git_ssh", instance, "username");
    if (gitName) {
      process.env.GIT_AUTHOR_NAME = gitName;
      process.env.GIT_COMMITTER_NAME = gitName;
      injectedEnvVars.push("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME");
    }
    const gitEmail = await loadCredentialField("git_ssh", instance, "email");
    if (gitEmail) {
      process.env.GIT_AUTHOR_EMAIL = gitEmail;
      process.env.GIT_COMMITTER_EMAIL = gitEmail;
      injectedEnvVars.push("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL");
    }
  }

  // Probe gateway and warn if not reachable
  const gatewayUrl = globalConfig.gateway?.url || `http://localhost:${globalConfig.gateway?.port || 8080}`;
  {
    const reachable = await probeGateway(gatewayUrl);
    if (!reachable) {
      console.log(
        `\u26a0 No gateway detected at ${gatewayUrl}. Resource locks, agent calls, and signals are unavailable.\n` +
        `  Start the scheduler with \`al start\` to enable these features.\n`
      );
    }
  }

  // Load SKILL.md body for context (but not as a prompt — user drives the session)
  const skillFile = resolve(projectPath, "agents", agentName, "SKILL.md");
  const skillContent = existsSync(skillFile)
    ? readFileSync(skillFile, "utf-8")
    : undefined;

  const credSummary = agentConfig.credentials
    .map((ref) => {
      const { type } = parseCredentialRef(ref);
      const def = builtinCredentials[type];
      return def?.agentContext ? `- ${def.agentContext}` : `- ${ref}`;
    })
    .join("\n");

  let fullContext = `# Agent: ${agentName}\n\nYou are in an interactive session scoped to the "${agentName}" agent's environment.\n`;
  fullContext += `The agent's credentials have been loaded and are available as environment variables.\n\n`;
  fullContext += `## Loaded Credentials\n\n${credSummary}\n`;
  if (agentConfig.params && Object.keys(agentConfig.params).length > 0) {
    fullContext += `\n## Agent Params\n\n\`\`\`json\n${JSON.stringify(agentConfig.params, null, 2)}\n\`\`\`\n`;
  }
  if (skillContent) {
    fullContext += `\n## Agent SKILL.md (reference — not auto-executed)\n\n${skillContent}\n`;
  }

  // Suppress pi-coding-agent's "Update Available" banner
  process.env.PI_SKIP_VERSION_CHECK = "1";
  ensureKeybindings();

  const keybindings = readKeybindings();
  printShortcuts(keybindings);

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

  const modelConfig = agentConfig.model || globalConfig.model || {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "medium" as const,
    authType: "api_key" as const,
  };

  const authStorage = AuthStorage.create();
  if (modelConfig.authType !== "pi_auth") {
    const credentialType = `${modelConfig.provider}_key`;
    const credential = await loadCredentialField(credentialType, "default", "token");
    if (credential) {
      authStorage.setRuntimeApiKey(modelConfig.provider, credential);
    }
  }

  const model = getModel(modelConfig.provider as any, modelConfig.model as any);
  const contextFile = skillFile;

  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    agentsFilesOverride: () => ({
      agentsFiles: [{ path: contextFile, content: fullContext }],
    }),
  });
  await resourceLoader.reload();

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
    quietStartup: true,
    hideThinkingBlock: true,
  });

  // Use the agent's directory as the working directory
  const agentDir = resolve(projectPath, "agents", agentName);

  const { session } = await createAgentSession({
    cwd: agentDir,
    model,
    thinkingLevel: modelConfig.thinkingLevel,
    authStorage,
    resourceLoader,
    tools: createCodingTools(agentDir, {
      bash: { commandPrefix: '[ -f /tmp/env.sh ] && source /tmp/env.sh' },
    }),
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  const initialMessage = `Interactive session for agent "${agentName}". What would you like to do?`;

  const mode = new InteractiveMode(session, { initialMessage });

  try {
    await mode.run();
  } finally {
    // Clean up injected env vars
    for (const envVar of injectedEnvVars) {
      delete process.env[envVar];
    }
    // Clean up temp SSH keys
    for (const p of cleanupPaths) {
      try { rmSync(p, { recursive: true }); } catch { /* best-effort */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Project-level chat: manage agents, create new ones (original behavior)
// ---------------------------------------------------------------------------

async function executeProjectChat(opts: ChatOpts): Promise<void> {
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
  printShortcuts(keybindings);

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
      const credential = await loadCredentialField("anthropic_key", "default", "token");
      if (credential) {
        authStorage.setRuntimeApiKey("anthropic", credential);
      }
    } else if (modelConfig.provider === "openai") {
      const credential = await loadCredentialField("openai_key", "default", "token");
      if (credential) {
        authStorage.setRuntimeApiKey("openai", credential);
      }
    }
  }

  const model = getModel(modelConfig.provider as any, modelConfig.model as any);

  // Load AGENTS.md context, appending agent summaries or no-agents guidance
  let fullContext = agentsContent || "";
  if (agents.length === 0) {
    fullContext += buildNoAgentsContext();
  } else if (agentSummaries.length > 0) {
    fullContext += `\n\n## Current Agents\n\n${agentSummaries.join("\n")}`;
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
    tools: createCodingTools(projectPath, {
      bash: { commandPrefix: '[ -f /tmp/env.sh ] && source /tmp/env.sh' },
    }),
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  const mode = new InteractiveMode(session, { initialMessage });
  await mode.run();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function probeGateway(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function printShortcuts(keybindings: Record<string, string | string[]>): void {
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

