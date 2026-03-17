/**
 * Integration test harness for end-to-end testing of the Action Llama stack.
 *
 * Runs real Docker containers, gateway, webhook dispatch, cron, work queues,
 * and control API — swapping the LLM for shell scripts inside containers.
 */

import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { stringify as stringifyTOML } from "smol-toml";
import type { GlobalConfig, AgentConfig } from "../../src/shared/config.js";
import type { WebhookContext } from "../../src/webhooks/types.js";
import { setDefaultBackend, resetDefaultBackend } from "../../src/shared/credentials.js";
import { FilesystemBackend } from "../../src/shared/filesystem-backend.js";
import { makeAgentConfig, makeModel } from "../helpers.js";

export interface HarnessAgent {
  name: string;
  /** Cron schedule (optional) */
  schedule?: string;
  /** Webhook triggers (optional) */
  webhooks?: AgentConfig["webhooks"];
  /** The test script to run instead of the LLM */
  testScript: string;
  /** Custom Dockerfile (optional — if provided, overrides the default entrypoint swap) */
  dockerfile?: string;
  /** Additional agent config overrides */
  config?: Partial<AgentConfig>;
}

export interface HarnessOptions {
  agents: HarnessAgent[];
  /** Global config overrides */
  globalConfig?: Partial<GlobalConfig>;
}

/**
 * Check if Docker daemon is available.
 */
export function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a random available port.
 */
function getRandomPort(): number {
  // Use a port in the dynamic range
  return 30000 + Math.floor(Math.random() * 20000);
}

export class IntegrationHarness {
  readonly projectPath: string;
  readonly gatewayPort: number;
  readonly credentialDir: string;

  private _scheduler: Awaited<ReturnType<typeof import("../../src/scheduler/index.js").startScheduler>> | null = null;
  readonly apiKey: string;

  private constructor(projectPath: string, gatewayPort: number, credentialDir: string, apiKey: string) {
    this.projectPath = projectPath;
    this.gatewayPort = gatewayPort;
    this.credentialDir = credentialDir;
    this.apiKey = apiKey;
  }

  static async create(opts: HarnessOptions): Promise<IntegrationHarness> {
    const projectPath = mkdtempSync(join(tmpdir(), "al-integration-"));
    const credentialDir = mkdtempSync(join(tmpdir(), "al-creds-"));
    const gatewayPort = getRandomPort();
    const apiKey = "test-api-key-" + Math.random().toString(36).slice(2);

    // Set up credential stubs
    const credTypes = [
      { type: "anthropic_key", instance: "default", field: "token", value: "sk-test-fake-key" },
      { type: "github_token", instance: "default", field: "token", value: "ghp-test-fake-token" },
      { type: "gateway_api_key", instance: "default", field: "key", value: apiKey },
    ];

    for (const cred of credTypes) {
      const credDir = resolve(credentialDir, cred.type, cred.instance);
      mkdirSync(credDir, { recursive: true });
      writeFileSync(resolve(credDir, cred.field), cred.value + "\n");
    }

    // Point the credential system at our temp dir
    setDefaultBackend(new FilesystemBackend(credentialDir));

    // Build webhook sources config if any agent uses webhooks
    const webhookSources: Record<string, { type: string }> = {};
    for (const agent of opts.agents) {
      if (agent.webhooks) {
        for (const trigger of agent.webhooks) {
          if (!webhookSources[trigger.source]) {
            webhookSources[trigger.source] = { type: "test" };
          }
        }
      }
    }

    // Write config.toml
    const globalConfig: GlobalConfig = {
      gateway: { port: gatewayPort },
      webhooks: Object.keys(webhookSources).length > 0 ? webhookSources : undefined,
      ...opts.globalConfig,
    };
    writeFileSync(
      resolve(projectPath, "config.toml"),
      stringifyTOML(globalConfig as Record<string, unknown>)
    );

    // Set up each agent
    for (const agent of opts.agents) {
      const agentPath = resolve(projectPath, "agents", agent.name);
      mkdirSync(agentPath, { recursive: true });

      // Write agent-config.toml
      const agentConfig = makeAgentConfig({
        name: agent.name,
        schedule: agent.schedule,
        webhooks: agent.webhooks,
        credentials: ["anthropic_key:default"],
        ...agent.config,
      });
      const { name: _, ...configToWrite } = agentConfig;
      writeFileSync(
        resolve(agentPath, "agent-config.toml"),
        stringifyTOML(configToWrite as Record<string, unknown>)
      );

      // Write ACTIONS.md
      writeFileSync(resolve(agentPath, "ACTIONS.md"), `# ${agent.name}\nTest agent.\n`);

      // Write test-script.sh
      writeFileSync(resolve(agentPath, "test-script.sh"), agent.testScript);

      // Write Dockerfile that uses the test script as entrypoint
      // Use sh (not bash) — base image is Alpine which has ash, not bash
      const dockerfile = agent.dockerfile || `FROM al-agent:latest\nENTRYPOINT ["sh", "/app/static/test-script.sh"]\n`;
      writeFileSync(resolve(agentPath, "Dockerfile"), dockerfile);
    }

    const harness = new IntegrationHarness(projectPath, gatewayPort, credentialDir, apiKey);
    return harness;
  }

  /**
   * Start the scheduler (triggers real Docker builds, gateway, cron, webhooks).
   */
  async start(): Promise<void> {
    const { startScheduler } = await import("../../src/scheduler/index.js");
    const globalConfig: GlobalConfig = {
      gateway: { port: this.gatewayPort },
    };

    // Re-load the actual config from disk
    const { loadGlobalConfig } = await import("../../src/shared/config.js");
    const loadedConfig = loadGlobalConfig(this.projectPath);

    this._scheduler = await startScheduler(
      this.projectPath,
      loadedConfig,
      undefined, // no status tracker
      false,     // not cloud mode
      true,      // gateway enabled
      false,     // no web UI
      false,     // no expose
    );
  }

  /**
   * Send a webhook to the gateway.
   */
  async sendWebhook(payload: Partial<WebhookContext>): Promise<Response> {
    const url = `http://127.0.0.1:${this.gatewayPort}/webhooks/test`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Call the control API.
   */
  async controlAPI(method: string, path: string, body?: any): Promise<Response> {
    const url = `http://127.0.0.1:${this.gatewayPort}/control${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Wait for an agent to complete at least one run.
   * Polls the runner pool until the agent is no longer running.
   */
  async waitForAgentRun(agentName: string, timeoutMs = 120_000): Promise<void> {
    const start = Date.now();
    const pool = this._scheduler?.runnerPools[agentName];
    if (!pool) throw new Error(`Agent "${agentName}" not found in runner pools`);

    // First wait for it to start running
    while (!pool.hasRunningJobs && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // Then wait for it to finish
    while (pool.hasRunningJobs && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (pool.hasRunningJobs) {
      throw new Error(`Agent "${agentName}" did not complete within ${timeoutMs}ms`);
    }
  }

  /**
   * Wait for a specific number of milliseconds for agent activity to settle.
   */
  async waitForSettle(ms = 2000): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Get the runner pool for an agent.
   */
  getRunnerPool(agentName: string) {
    return this._scheduler?.runnerPools[agentName];
  }

  /**
   * Get the webhook registry.
   */
  get webhookRegistry() {
    return this._scheduler?.webhookRegistry;
  }

  /**
   * Get the gateway server.
   */
  get gateway() {
    return this._scheduler?.gateway;
  }

  /**
   * Shut down the scheduler and clean up.
   */
  async shutdown(): Promise<void> {
    if (this._scheduler) {
      // Stop cron jobs
      for (const job of this._scheduler.cronJobs) {
        job.stop();
      }
      // Close gateway
      if (this._scheduler.gateway) {
        await this._scheduler.gateway.close();
      }
      this._scheduler = null;
    }

    // Reset credential backend
    resetDefaultBackend();
  }
}
