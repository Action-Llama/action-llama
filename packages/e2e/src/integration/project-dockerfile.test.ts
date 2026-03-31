/**
 * Integration test: verify that a project-level Dockerfile is used as the
 * base image for all agents in the project.
 *
 * When <projectPath>/Dockerfile exists with custom instructions (beyond a bare
 * FROM), the image builder builds it as the project base image. Per-agent
 * images then inherit from this project base.
 *
 * Covers: isProjectDockerfileCustomized() + project base image build pipeline.
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: project-level Dockerfile", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("project Dockerfile adds package available to all agents", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "project-base-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            // python3 was installed by the project Dockerfile — verify it's available
            "python3 --version || { echo 'python3 not found — project Dockerfile not applied'; exit 1; }",
            'echo "project-base-agent: python3 from project Dockerfile OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Write a project-level Dockerfile that adds python3
    // The builder will use this as the project base image (replacing the default base)
    writeFileSync(
      resolve(harness.projectPath, "Dockerfile"),
      ["FROM node:20-alpine", "RUN apk add --no-cache python3"].join("\n"),
    );

    await harness.start();
    await harness.triggerAgent("project-base-agent");

    const run = await harness.waitForRunResult("project-base-agent", 240_000);
    expect(run.result).toBe("completed");
  });

  it("multiple agents all inherit from project-level Dockerfile", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "inheritor-a",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "python3 --version || { echo 'inheritor-a: python3 not found'; exit 1; }",
            "exit 0",
          ].join("\n"),
        },
        {
          name: "inheritor-b",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "python3 --version || { echo 'inheritor-b: python3 not found'; exit 1; }",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    // Write project Dockerfile
    writeFileSync(
      resolve(harness.projectPath, "Dockerfile"),
      ["FROM node:20-alpine", "RUN apk add --no-cache python3"].join("\n"),
    );

    await harness.start();

    await harness.triggerAgent("inheritor-a");
    await harness.triggerAgent("inheritor-b");

    const [runA, runB] = await Promise.all([
      harness.waitForRunResult("inheritor-a", 240_000),
      harness.waitForRunResult("inheritor-b", 240_000),
    ]);

    expect(runA.result).toBe("completed");
    expect(runB.result).toBe("completed");
  });
});
