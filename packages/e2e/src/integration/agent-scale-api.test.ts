/**
 * Integration test: per-agent scale update via the control API.
 *
 * Tests the POST /control/agents/:name/scale endpoint which updates the
 * agent-level scale in config.toml at runtime. This is distinct from the
 * project-level scale cap (POST /control/project/scale).
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/agents/:name/scale
 *   - scheduler/gateway-setup.ts: updateAgentScale handler
 *   - shared/config: updateAgentRuntimeField() write path
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: per-agent scale control API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("POST /control/agents/:name/scale updates agent scale in config.toml", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scalable-agent",
          schedule: "0 0 31 2 *",
          config: { scale: 1 },
          testScript: "#!/bin/sh\necho 'scalable-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Verify the agent works before scale update.
    await harness.triggerAgent("scalable-agent");
    const baseRun = await harness.waitForRunResult("scalable-agent", 120_000);
    expect(baseRun.result).toBe("completed");

    // Update agent scale to 2 via control API.
    const res = await harness.controlAPI("POST", "/agents/scalable-agent/scale", { scale: 2 });
    expect(res.ok).toBe(true);

    const body = await res.json() as { success: boolean; message?: string };
    expect(body.success).toBe(true);
    expect(body.message).toContain("2");

    // Verify the agent's config.toml was updated on disk.
    const agentConfigPath = resolve(harness.projectPath, "agents", "scalable-agent", "config.toml");
    const configContent = readFileSync(agentConfigPath, "utf-8");
    expect(configContent).toContain("scale = 2");
  });

  it("POST /control/agents/:name/scale returns 404 for nonexistent agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "existing-scale-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Trigger and complete one run before the scale check.
    await harness.triggerAgent("existing-scale-agent");
    await harness.waitForRunResult("existing-scale-agent", 120_000);

    const res = await harness.controlAPI("POST", "/agents/nonexistent-agent/scale", { scale: 2 });
    expect(res.status).toBe(404);
  });

  it("POST /control/agents/:name/scale returns 400 for scale=0", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-zero-check-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("scale-zero-check-agent");
    await harness.waitForRunResult("scale-zero-check-agent", 120_000);

    const res = await harness.controlAPI("POST", "/agents/scale-zero-check-agent/scale", { scale: 0 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it("POST /control/agents/:name/scale returns 400 for negative scale", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-neg-check-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("scale-neg-check-agent");
    await harness.waitForRunResult("scale-neg-check-agent", 120_000);

    const res = await harness.controlAPI("POST", "/agents/scale-neg-check-agent/scale", { scale: -1 });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it("POST /control/agents/:name/scale returns 400 for non-numeric scale", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-nonnum-check-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("scale-nonnum-check-agent");
    await harness.waitForRunResult("scale-nonnum-check-agent", 120_000);

    const res = await harness.controlAPI("POST", "/agents/scale-nonnum-check-agent/scale", { scale: "invalid" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });
});
