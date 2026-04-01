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
import { createServer } from "net";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import type { GlobalConfig, AgentConfig } from "@action-llama/action-llama/internals/config";
import type { WebhookContext } from "@action-llama/action-llama/internals/webhook-types";
import { setDefaultBackend, resetDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";
import type { RunCompleteEvent } from "@action-llama/action-llama/internals/execution";
import type { SchedulerEventBus, SchedulerEventMap } from "@action-llama/action-llama/internals/scheduler-events";
import { makeAgentConfig, makeModel } from "./helpers.js";

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
 * Get an available port in the dynamic range.
 * Uses Node.js built-in port allocation to find an actually available port.
 */
function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error('Failed to get port from server address'));
        }
      });
    });
  });
}

export class IntegrationHarness {
  readonly projectPath: string;
  readonly gatewayPort: number;
  readonly credentialDir: string;

  private _scheduler: Awaited<ReturnType<typeof import("@action-llama/action-llama/internals/scheduler").startScheduler>> | null = null;
  readonly apiKey: string;

  /** The event bus from the scheduler — exposed so tests can subscribe. */
  private _events: SchedulerEventBus | null = null;

  /** Collected run completion events, keyed by agent name. */
  private _runResults: Map<string, RunCompleteEvent[]> = new Map();
  /** Listeners waiting for a specific agent's run to complete. */
  private _runWaiters: Map<string, Array<(event: RunCompleteEvent) => void>> = new Map();

  private constructor(projectPath: string, gatewayPort: number, credentialDir: string, apiKey: string) {
    this.projectPath = projectPath;
    this.gatewayPort = gatewayPort;
    this.credentialDir = credentialDir;
    this.apiKey = apiKey;
  }

  static async create(opts: HarnessOptions): Promise<IntegrationHarness> {
    const projectPath = mkdtempSync(join(tmpdir(), "al-integration-"));
    const credentialDir = mkdtempSync(join(tmpdir(), "al-creds-"));
    const gatewayPort = await getAvailablePort();
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

    // Write config.toml (with named model definitions)
    const globalConfig: GlobalConfig = {
      models: { sonnet: makeModel() },
      gateway: { port: gatewayPort },
      webhooks: Object.keys(webhookSources).length > 0 ? webhookSources : undefined,
      ...opts.globalConfig,
    };

    // Set up each agent
    for (const agent of opts.agents) {
      const agentPath = resolve(projectPath, "agents", agent.name);
      mkdirSync(agentPath, { recursive: true });

      // Build agent config for extracting fields
      const agentConfig = makeAgentConfig({
        name: agent.name,
        schedule: agent.schedule,
        webhooks: agent.webhooks,
        credentials: ["anthropic_key"],
        ...agent.config,
      });

      // Write portable SKILL.md
      const frontmatter: Record<string, unknown> = { name: agent.name };
      if (agentConfig.description) frontmatter.description = agentConfig.description;
      const yamlStr = stringifyYAML(frontmatter).trimEnd();
      writeFileSync(
        resolve(agentPath, "SKILL.md"),
        `---\n${yamlStr}\n---\n\n# ${agent.name}\nTest agent.\n`
      );

      // Write per-agent config.toml
      const runtimeConfig: Record<string, unknown> = {
        models: ["sonnet"],
        credentials: agentConfig.credentials,
      };
      if (agentConfig.schedule) runtimeConfig.schedule = agentConfig.schedule;
      if (agentConfig.webhooks?.length) runtimeConfig.webhooks = agentConfig.webhooks;
      if (agentConfig.hooks) runtimeConfig.hooks = agentConfig.hooks;
      if (agentConfig.params && Object.keys(agentConfig.params).length > 0) runtimeConfig.params = agentConfig.params;
      if (agentConfig.scale !== undefined) runtimeConfig.scale = agentConfig.scale;
      if (agentConfig.timeout !== undefined) runtimeConfig.timeout = agentConfig.timeout;
      writeFileSync(resolve(agentPath, "config.toml"), stringifyTOML(runtimeConfig));

      // Write test-script.sh — container-entry.js detects this file at
      // /app/static/test-script.sh and runs it instead of the LLM agent.
      writeFileSync(resolve(agentPath, "test-script.sh"), agent.testScript);

      // Only write a custom Dockerfile if the test explicitly provides one
      if (agent.dockerfile) {
        writeFileSync(resolve(agentPath, "Dockerfile"), agent.dockerfile);
      }
    }

    // Write config.toml after agent loop (agents may add runtime overrides)
    writeFileSync(
      resolve(projectPath, "config.toml"),
      stringifyTOML(globalConfig as Record<string, unknown>)
    );

    const harness = new IntegrationHarness(projectPath, gatewayPort, credentialDir, apiKey);
    return harness;
  }

  /**
   * Start the scheduler (triggers real Docker builds, gateway, cron, webhooks).
   *
   * @param opts.webUI - Enable web UI routes including chat session management (default: false)
   */
  async start(opts?: { webUI?: boolean }): Promise<void> {
    const { startScheduler } = await import("@action-llama/action-llama/internals/scheduler");
    const globalConfig: GlobalConfig = {
      gateway: { port: this.gatewayPort },
    };

    // Re-load the actual config from disk
    const { loadGlobalConfig } = await import("@action-llama/action-llama/internals/config");
    const loadedConfig = loadGlobalConfig(this.projectPath);

    this._scheduler = await startScheduler(
      this.projectPath,
      loadedConfig,
      undefined,            // no status tracker
      opts?.webUI ?? false, // web UI (enables chat routes when true)
      true,                 // expose — bind to 0.0.0.0 so Docker containers can reach gateway via host-gateway
    );

    // Wire up run completion instrumentation via the event bus
    this._events = this._scheduler.events;
    if (this._events) {
      this._events.on("run:end", (event) => {
        const runComplete: RunCompleteEvent = {
          agentName: event.agentName,
          result: event.result,
          triggerType: "unknown",
        };
        const list = this._runResults.get(event.agentName) || [];
        list.push(runComplete);
        this._runResults.set(event.agentName, list);

        // Notify any waiters
        const waiters = this._runWaiters.get(event.agentName);
        if (waiters) {
          const waiter = waiters.shift();
          if (waiter) waiter(runComplete);
          if (waiters.length === 0) this._runWaiters.delete(event.agentName);
        }
      });
    }
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
   * Manually trigger an agent run via the control API.
   *
   * This method is used in integration tests to manually start agents
   * since automatic initial runs of scheduled agents were removed.
   *
   * @param agentName - The name of the agent to trigger
   * @throws {Error} If the trigger request fails or the agent doesn't exist
   */
  async triggerAgent(agentName: string): Promise<void> {
    const response = await this.controlAPI('POST', `/trigger/${agentName}`);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to trigger agent ${agentName}: ${response.status} ${error}`);
    }
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Failed to trigger agent ${agentName}: ${result.error || 'Unknown error'}`);
    }
  }

  /**
   * Wait for an agent to complete at least one run.
   * Polls the runner pool until the agent is no longer running.
   */
  async waitForAgentRun(agentName: string, timeoutMs = 120_000): Promise<void> {
    const start = Date.now();
    const pool = this._scheduler?.runnerPools[agentName];
    if (!pool) throw new Error(`Agent "${agentName}" not found in runner pools`);

    // Wait for the agent to start running, but only up to 15s.
    // If it doesn't start within that window, it likely already completed
    // its run before we began polling (e.g. fast container exit in CI).
    const startWaitLimit = Math.min(15_000, timeoutMs);
    while (!pool.hasRunningJobs && Date.now() - start < startWaitLimit) {
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
   * Poll until a runner pool has no running jobs, with a timeout.
   */
  async waitForIdle(agentName: string, timeoutMs = 30_000, pollMs = 250): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pool = this.getRunnerPool(agentName);
      if (!pool || !pool.hasRunningJobs) return;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`${agentName} runner pool still has running jobs after ${timeoutMs}ms`);
  }

  /**
   * Poll until a runner pool has at least one running job, with a timeout.
   */
  async waitForRunning(agentName: string, timeoutMs = 30_000, pollMs = 250): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pool = this.getRunnerPool(agentName);
      if (pool?.hasRunningJobs) return;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`${agentName} runner pool has no running jobs after ${timeoutMs}ms`);
  }

  /**
   * Get the runner pool for an agent.
   */
  getRunnerPool(agentName: string) {
    return this._scheduler?.runnerPools[agentName];
  }

  /**
   * Wait for a specific agent's run to complete and return the result.
   * If the agent already completed, returns the next unconsumed result.
   */
  async waitForRunResult(agentName: string, timeoutMs = 120_000): Promise<RunCompleteEvent> {
    // Check if we already have an unconsumed result
    const existing = this._runResults.get(agentName);
    if (existing && existing.length > 0) {
      return existing.shift()!;
    }

    // Wait for the next result
    return new Promise<RunCompleteEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent "${agentName}" did not complete within ${timeoutMs}ms`));
      }, timeoutMs);

      const waiters = this._runWaiters.get(agentName) || [];
      waiters.push((event) => {
        clearTimeout(timer);
        resolve(event);
      });
      this._runWaiters.set(agentName, waiters);
    });
  }

  /**
   * Get all collected run results for an agent (non-destructive).
   */
  getRunResults(agentName: string): readonly RunCompleteEvent[] {
    return this._runResults.get(agentName) || [];
  }

  /**
   * Get the scheduler event bus for lifecycle instrumentation.
   * Use `waitFor()` and `collect()` to observe events without polling.
   */
  get events(): SchedulerEventBus {
    if (!this._events) throw new Error("Harness not started — call start() first");
    return this._events;
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
      // Kill any running containers so they don't become orphans
      for (const pool of Object.values(this._scheduler.runnerPools)) {
        pool.killAll();
      }
      // Brief pause to let container kills propagate
      await new Promise((r) => setTimeout(r, 500));

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

    if (this._events) {
      this._events.removeAllListeners();
      this._events = null;
    }

    // Reset credential backend
    resetDefaultBackend();
  }

  /**
   * Simulates a scheduler crash: stops cron jobs and closes the gateway
   * WITHOUT killing running containers. Running containers keep going and
   * become "orphans" that the next scheduler start will need to recover.
   *
   * Use this only for testing orphan-recovery scenarios. Does NOT call
   * resetDefaultBackend() — caller is responsible for restoring credentials
   * before calling start() again.
   */
  async shutdownNoKill(): Promise<void> {
    if (this._scheduler) {
      // Stop cron jobs (prevents new triggers while gateway is closing)
      for (const job of this._scheduler.cronJobs) {
        job.stop();
      }
      // Close gateway — simulates crash, does NOT kill containers
      if (this._scheduler.gateway) {
        await this._scheduler.gateway.close();
      }
      this._scheduler = null;
    }

    if (this._events) {
      this._events.removeAllListeners();
      this._events = null;
    }

    // Reset credential backend so start() can re-initialise
    resetDefaultBackend();
  }
}
