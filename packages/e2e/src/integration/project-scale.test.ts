/**
 * Integration test: project-level scale update via the control API.
 *
 * Tests the POST /control/project/scale endpoint which updates the global
 * scale cap in config.toml at runtime. This cap limits the total number of
 * concurrent agent runners across the project.
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/project/scale (valid + invalid inputs)
 *   - shared/config/load-project.ts: updateProjectScale() write path
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: project scale control API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("POST /control/project/scale updates project scale successfully", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-target-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Update project scale to 5
    const res = await harness.controlAPI("POST", "/project/scale", { scale: 5 });
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("5");

    // Verify the config.toml was actually updated on disk
    const configToml = readFileSync(resolve(harness.projectPath, "config.toml"), "utf-8");
    expect(configToml).toContain("scale = 5");
  });

  it("POST /control/project/scale rejects scale=0 with 400", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-zero-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await harness.controlAPI("POST", "/project/scale", { scale: 0 });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/positive integer/i);
  });

  it("POST /control/project/scale rejects negative scale with 400", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-neg-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await harness.controlAPI("POST", "/project/scale", { scale: -1 });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/positive integer/i);
  });

  it("POST /control/project/scale rejects non-numeric scale with 400", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-str-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await harness.controlAPI("POST", "/project/scale", { scale: "bad" });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/positive integer/i);
  });

  it("scale update persists: second update overwrites first", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-overwrite-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // First update: scale=3
    const res1 = await harness.controlAPI("POST", "/project/scale", { scale: 3 });
    expect(res1.ok).toBe(true);

    // Second update: scale=7
    const res2 = await harness.controlAPI("POST", "/project/scale", { scale: 7 });
    expect(res2.ok).toBe(true);

    // Verify final state is scale=7 on disk
    const configToml = readFileSync(resolve(harness.projectPath, "config.toml"), "utf-8");
    expect(configToml).toContain("scale = 7");
    // Old value should be gone
    expect(configToml).not.toContain("scale = 3");
  });

  it("agent runs continue to work after project scale update", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "post-scale-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'still running'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Update project scale
    const scaleRes = await harness.controlAPI("POST", "/project/scale", { scale: 2 });
    expect(scaleRes.ok).toBe(true);

    // Agent should still be triggerable and run to completion
    await harness.triggerAgent("post-scale-agent");
    const run = await harness.waitForRunResult("post-scale-agent");
    expect(run.result).toBe("completed");
  });
});
