/**
 * Integration test: verify scheduler behaviour when agent image builds fail.
 *
 * When a Dockerfile is invalid (e.g., contains `RUN exit 1`), the Docker
 * build step fails. The scheduler should propagate this as an error during
 * startup rather than starting in a broken state.
 *
 * Covers: image build failure error handling (not previously tested).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: image build failure handling", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("scheduler startup fails when agent custom Dockerfile has a failing RUN step", async () => {
    // Create an agent with a Dockerfile that intentionally fails to build.
    // The `RUN exit 1` instruction will cause `docker build` to fail.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "bad-docker-agent",
          schedule: "0 0 31 2 *",
          dockerfile: [
            "FROM node:20-alpine",
            // Intentionally fail the build
            "RUN exit 1",
          ].join("\n"),
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // The start() call should throw because the image build fails
    await expect(harness.start()).rejects.toThrow();

    // The harness should be in an unusable state — trying to trigger should
    // fail because the scheduler never started (or the agent pool is empty).
    // We don't need to assert anything further; the throw above is sufficient.
  });

  it("scheduler starts successfully when a valid custom Dockerfile is provided", async () => {
    // Positive test: valid custom Dockerfile should build and run fine.
    // (This complements the failure test above to confirm the harness works correctly.)
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "good-docker-agent",
          schedule: "0 0 31 2 *",
          dockerfile: [
            "FROM node:20-alpine",
            // Valid RUN step — just list files
            "RUN ls /",
          ].join("\n"),
          testScript: "#!/bin/sh\necho 'good-docker-agent OK'\nexit 0\n",
        },
      ],
    });

    // This should NOT throw
    await expect(harness.start()).resolves.toBeUndefined();

    await harness.triggerAgent("good-docker-agent");
    const run = await harness.waitForRunResult("good-docker-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
