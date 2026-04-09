/**
 * Integration test: verify that the image build pipeline (project base + agent
 * images) works end-to-end with the transport runner.
 *
 * Tests:
 * 1. ensureProjectBaseImage() builds from project Dockerfile
 * 2. ensureAgentImage() builds from agent Dockerfile, inheriting from project base
 * 3. Image caching — repeated calls skip builds when tags already exist
 *
 * Covers: transport runner image build integration — ensures agents get their
 * custom packages and tools when running in containers.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Clean up Docker images created during tests. */
function removeImage(tag: string): void {
  try {
    execFileSync("docker", ["rmi", "-f", tag], {
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { /* image may not exist */ }
}

describe.skipIf(!DOCKER)("integration: agent image build pipeline", { timeout: 120_000 }, () => {
  const imagesToCleanup: string[] = [];
  let projectPath: string;

  afterEach(() => {
    for (const tag of imagesToCleanup) {
      removeImage(tag);
    }
    imagesToCleanup.length = 0;
  });

  it("ensureProjectBaseImage builds from customized Dockerfile", async () => {
    const { ensureProjectBaseImage, imageExists } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-projimg-"));
    writeFileSync(
      join(projectPath, "Dockerfile"),
      "FROM node:20-alpine\nRUN apk add --no-cache curl\n",
    );

    // Remove any cached image from prior runs
    const { CONSTANTS } = await import("@action-llama/action-llama/internals/constants");
    const expectedTag = CONSTANTS.PROJECT_BASE_IMAGE;
    removeImage(expectedTag);
    imagesToCleanup.push(expectedTag);

    const tag = await ensureProjectBaseImage(projectPath, "node:20-alpine");
    expect(tag).toBe(expectedTag);
    expect(imageExists(tag)).toBe(true);

    // Verify curl is available in the built image
    const output = execFileSync("docker", [
      "run", "--rm", tag, "curl", "--version",
    ], { encoding: "utf-8", timeout: 30_000 });
    expect(output).toContain("curl");
  });

  it("ensureProjectBaseImage returns baseImage when Dockerfile is bare FROM", async () => {
    const { ensureProjectBaseImage } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-projimg-"));
    writeFileSync(join(projectPath, "Dockerfile"), "FROM node:20-alpine\n");

    const tag = await ensureProjectBaseImage(projectPath, "node:20-alpine");
    expect(tag).toBe("node:20-alpine");
  });

  it("ensureProjectBaseImage returns baseImage when no Dockerfile exists", async () => {
    const { ensureProjectBaseImage } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-projimg-"));

    const tag = await ensureProjectBaseImage(projectPath, "node:20-alpine");
    expect(tag).toBe("node:20-alpine");
  });

  it("ensureAgentImage builds from agent Dockerfile", async () => {
    const { ensureAgentImage, imageExists } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-agentimg-"));
    const agentDir = join(projectPath, "agents", "test-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "Dockerfile"),
      "FROM node:20-alpine\nRUN apk add --no-cache jq\n",
    );

    const { CONSTANTS } = await import("@action-llama/action-llama/internals/constants");
    const expectedTag = CONSTANTS.agentImage("test-agent");
    removeImage(expectedTag);
    imagesToCleanup.push(expectedTag);

    const tag = await ensureAgentImage("test-agent", projectPath, "node:20-alpine");
    expect(tag).toBe(expectedTag);
    expect(imageExists(tag)).toBe(true);

    // Verify jq is available in the built image
    const output = execFileSync("docker", [
      "run", "--rm", tag, "jq", "--version",
    ], { encoding: "utf-8", timeout: 30_000 });
    expect(output).toContain("jq");
  });

  it("ensureAgentImage returns baseImage when no agent Dockerfile", async () => {
    const { ensureAgentImage } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-agentimg-"));
    mkdirSync(join(projectPath, "agents", "no-docker"), { recursive: true });

    const tag = await ensureAgentImage("no-docker", projectPath, "node:20-alpine");
    expect(tag).toBe("node:20-alpine");
  });

  it("project base + agent image layering works", async () => {
    const { ensureProjectBaseImage, ensureAgentImage, imageExists } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );
    const { CONSTANTS } = await import("@action-llama/action-llama/internals/constants");

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-layered-"));

    // Project Dockerfile installs curl
    writeFileSync(
      join(projectPath, "Dockerfile"),
      "FROM node:20-alpine\nRUN apk add --no-cache curl\n",
    );

    // Agent Dockerfile installs jq (on top of project base)
    const agentDir = join(projectPath, "agents", "layered-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "Dockerfile"),
      "FROM al-agent:latest\nUSER root\nRUN apk add --no-cache jq\nUSER node\n",
    );

    const projectTag = CONSTANTS.PROJECT_BASE_IMAGE;
    const agentTag = CONSTANTS.agentImage("layered-agent");
    removeImage(agentTag);
    removeImage(projectTag);
    imagesToCleanup.push(agentTag, projectTag);

    // Build project base first
    const baseTag = await ensureProjectBaseImage(projectPath, "node:20-alpine");
    expect(imageExists(baseTag)).toBe(true);

    // Build agent image on top of project base
    const finalTag = await ensureAgentImage("layered-agent", projectPath, baseTag);
    expect(imageExists(finalTag)).toBe(true);

    // Verify BOTH curl (from project) and jq (from agent) are available
    const curlOutput = execFileSync("docker", [
      "run", "--rm", finalTag, "curl", "--version",
    ], { encoding: "utf-8", timeout: 30_000 });
    expect(curlOutput).toContain("curl");

    const jqOutput = execFileSync("docker", [
      "run", "--rm", finalTag, "jq", "--version",
    ], { encoding: "utf-8", timeout: 30_000 });
    expect(jqOutput).toContain("jq");
  });

  it("image caching skips redundant builds", async () => {
    const { ensureAgentImage, imageExists } = await import(
      "@action-llama/action-llama/internals/docker-image"
    );
    const { CONSTANTS } = await import("@action-llama/action-llama/internals/constants");

    projectPath = mkdtempSync(join(tmpdir(), "al-e2e-cache-"));
    const agentDir = join(projectPath, "agents", "cached-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "Dockerfile"),
      "FROM node:20-alpine\nRUN echo cached\n",
    );

    const expectedTag = CONSTANTS.agentImage("cached-agent");
    removeImage(expectedTag);
    imagesToCleanup.push(expectedTag);

    // First build
    const tag1 = await ensureAgentImage("cached-agent", projectPath, "node:20-alpine");
    expect(tag1).toBe(expectedTag);
    expect(imageExists(tag1)).toBe(true);

    // Second call should skip the build (image already exists)
    const progressMessages: string[] = [];
    const tag2 = await ensureAgentImage("cached-agent", projectPath, "node:20-alpine", (msg) => {
      progressMessages.push(msg);
    });
    expect(tag2).toBe(expectedTag);
    expect(progressMessages.some((m) => m.includes("already built"))).toBe(true);
  });
});
