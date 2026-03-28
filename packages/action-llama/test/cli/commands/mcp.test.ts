import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

vi.mock("../../../src/mcp/server.js", () => ({
  startMcpServer: vi.fn().mockResolvedValue(undefined),
}));

import { serve, init } from "../../../src/cli/commands/mcp.js";
import * as mcpServer from "../../../src/mcp/server.js";

const mockedStartMcpServer = vi.mocked(mcpServer.startMcpServer);

describe("mcp serve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls startMcpServer with the resolved project path", async () => {
    await serve({ project: "/my/project" });

    expect(mockedStartMcpServer).toHaveBeenCalledOnce();
    const call = mockedStartMcpServer.mock.calls[0][0];
    expect(call.projectPath).toBe(resolve("/my/project"));
    expect(call.envName).toBeUndefined();
  });

  it("passes env option to startMcpServer", async () => {
    await serve({ project: "/my/project", env: "production" });

    const call = mockedStartMcpServer.mock.calls[0][0];
    expect(call.envName).toBe("production");
  });
});

describe("mcp init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-mcp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new .mcp.json when it does not exist", async () => {
    await init({ project: tmpDir });

    const mcpJsonPath = resolve(tmpDir, ".mcp.json");
    expect(existsSync(mcpJsonPath)).toBe(true);

    const content = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(content).toEqual({
      mcpServers: {
        "action-llama": {
          command: "al",
          args: ["mcp", "serve"],
        },
      },
    });
  });

  it("logs the path to .mcp.json after writing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await init({ project: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(".mcp.json"));
    consoleSpy.mockRestore();
  });

  it("adds action-llama entry to existing .mcp.json that already has mcpServers", async () => {
    const mcpJsonPath = resolve(tmpDir, ".mcp.json");
    writeFileSync(mcpJsonPath, JSON.stringify({
      mcpServers: {
        "other-tool": { command: "other", args: [] },
      },
    }, null, 2));

    await init({ project: tmpDir });

    const content = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(content.mcpServers["action-llama"]).toEqual({
      command: "al",
      args: ["mcp", "serve"],
    });
    // Existing entry should be preserved
    expect(content.mcpServers["other-tool"]).toEqual({ command: "other", args: [] });
  });

  it("overwrites existing action-llama entry in .mcp.json and logs a message", async () => {
    const mcpJsonPath = resolve(tmpDir, ".mcp.json");
    writeFileSync(mcpJsonPath, JSON.stringify({
      mcpServers: {
        "action-llama": { command: "old", args: ["old-arg"] },
      },
    }, null, 2));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await init({ project: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Overwriting"));
    const content = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(content.mcpServers["action-llama"]).toEqual({
      command: "al",
      args: ["mcp", "serve"],
    });
    consoleSpy.mockRestore();
  });

  it("adds mcpServers key to existing .mcp.json that is missing it", async () => {
    const mcpJsonPath = resolve(tmpDir, ".mcp.json");
    writeFileSync(mcpJsonPath, JSON.stringify({ otherKey: "value" }, null, 2));

    await init({ project: tmpDir });

    const content = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers["action-llama"]).toEqual({
      command: "al",
      args: ["mcp", "serve"],
    });
    // Original key should be preserved
    expect(content.otherKey).toBe("value");
  });
});
