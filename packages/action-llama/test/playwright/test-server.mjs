/**
 * Lightweight gateway server for Playwright dashboard tests.
 *
 * Imports from the compiled dist/ directory — run `npm run build` first.
 *
 * Registers two agents (scale=1 and scale=2) and wires up full mock
 * implementations for all control deps so every dashboard interaction
 * can be tested end-to-end.
 */
import { startGateway } from "../../dist/gateway/index.js";
import { StatusTracker } from "../../dist/tui/status-tracker.js";
import pino from "pino";

const PORT = parseInt(process.env.TEST_PORT || "8199", 10);
const API_KEY = "pw-test-key-12345";
const logger = pino({ level: "silent" });
const statusTracker = new StatusTracker();

/** Maps instanceId → { agentName, lifecycle } for kill operations. */
const activeInstances = new Map();
let triggerCount = 0;

// ── Initial agent setup ──────────────────────────────────────────────
statusTracker.registerAgent("single-agent", 1);
statusTracker.registerAgent("scaled-agent", 2);

statusTracker.setSchedulerInfo({
  mode: "host",
  gatewayPort: PORT,
  cronJobCount: 2,
  webhooksActive: false,
  webhookUrls: [],
  startedAt: new Date(),
  paused: false,
});

// ── Start gateway ────────────────────────────────────────────────────
await startGateway({
  port: PORT,
  logger,
  statusTracker,
  webUI: true,
  apiKey: API_KEY,
  controlDeps: {
    statusTracker,

    triggerAgent: async (name) => {
      const agent = statusTracker.getAllAgents().find((a) => a.name === name);
      if (!agent) return false;

      triggerCount++;
      const instanceId = `${name}-pw-${triggerCount}`;

      // Simulate the real execution flow:
      // 1. Create instance lifecycle and start it
      const lifecycle = statusTracker.createInstance(instanceId, name, "manual");
      lifecycle?.start();

      // 2. Register the instance so getInstances() returns it
      statusTracker.registerInstance({
        id: instanceId,
        agentName: name,
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      // 3. Track for kill operations
      activeInstances.set(instanceId, { agentName: name, lifecycle });

      // 4. Runner calls startRun (authoritative source for runningCount)
      statusTracker.startRun(name, "manual trigger");

      return true;
    },

    killInstance: async (instanceId) => {
      const info = activeInstances.get(instanceId);
      if (!info) return false;

      if (info.lifecycle && !info.lifecycle.isTerminal()) {
        info.lifecycle.kill();
      }
      statusTracker.endRun(info.agentName, 0);
      statusTracker.completeInstance(instanceId, "killed");
      statusTracker.unregisterInstance(instanceId);
      activeInstances.delete(instanceId);
      return true;
    },

    killAgent: async (name) => {
      let killed = 0;
      for (const [id, info] of [...activeInstances.entries()]) {
        if (info.agentName === name) {
          if (info.lifecycle && !info.lifecycle.isTerminal()) {
            info.lifecycle.kill();
          }
          statusTracker.endRun(name, 0);
          statusTracker.completeInstance(id, "killed");
          statusTracker.unregisterInstance(id);
          activeInstances.delete(id);
          killed++;
        }
      }
      return { killed };
    },

    pauseScheduler: async () => statusTracker.setPaused(true),
    resumeScheduler: async () => statusTracker.setPaused(false),

    enableAgent: async (name) => {
      if (!statusTracker.getAllAgents().find((a) => a.name === name)) return false;
      statusTracker.enableAgent(name);
      return true;
    },

    disableAgent: async (name) => {
      if (!statusTracker.getAllAgents().find((a) => a.name === name)) return false;
      statusTracker.disableAgent(name);
      return true;
    },

    updateProjectScale: async () => true,

    updateAgentScale: async (name, scale) => {
      if (!statusTracker.getAllAgents().find((a) => a.name === name)) return false;
      statusTracker.updateAgentScale(name, scale);
      return true;
    },

    logger,
  },
});

console.log(JSON.stringify({ port: PORT, apiKey: API_KEY }));
