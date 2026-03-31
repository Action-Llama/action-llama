/**
 * Integration test: verify that agents with custom Dockerfiles are built and
 * run correctly. The custom Dockerfile adds a package (python3) not present in
 * the default base image, and the test-script.sh verifies that the package is
 * available inside the running container.
 *
 * Covers: COVERAGE-GAPS.md — "Deployment with custom Dockerfile"
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: custom Dockerfile", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("builds agent image from custom Dockerfile and runs agent with custom tool", async () => {
    // Create agent with a custom Dockerfile that installs python3
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "custom-docker-agent",
          schedule: "0 0 31 2 *", // never fires by cron
          // Custom Dockerfile: starts from the default base image (the builder
          // replaces the FROM directive with the real base image) and adds python3.
          dockerfile: [
            "FROM node:20-alpine",
            "RUN apk add --no-cache python3",
          ].join("\n"),
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify python3 was installed by the custom Dockerfile
            "python3 --version || { echo 'python3 not found — custom Dockerfile was not used'; exit 1; }",
            'echo "custom-docker-agent: python3 is available"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Manually trigger the agent
    await harness.triggerAgent("custom-docker-agent");

    // Wait for the run — allow extra time for the custom image build
    const run = await harness.waitForRunResult("custom-docker-agent", 240_000);
    expect(run.result).toBe("completed");
  });

  it("custom Dockerfile can install multiple extra packages and they are all accessible", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "multi-pkg-agent",
          schedule: "0 0 31 2 *",
          dockerfile: [
            "FROM node:20-alpine",
            "RUN apk add --no-cache python3 bash",
          ].join("\n"),
          testScript: [
            "#!/bin/bash",
            "set -e",
            // Verify python3 is available
            "python3 --version || { echo 'python3 not found'; exit 1; }",
            // Verify we're running under bash (not sh)
            'test -n "$BASH_VERSION" || { echo "not running under bash"; exit 1; }',
            'echo "multi-pkg-agent: python3 and bash are available"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("multi-pkg-agent");

    const run = await harness.waitForRunResult("multi-pkg-agent", 240_000);
    expect(run.result).toBe("completed");
  });
});
