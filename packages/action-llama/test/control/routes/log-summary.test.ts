import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { registerLogSummaryRoutes } from "../../../src/control/routes/log-summary.js";

// Module-level mock so vitest can hoist it properly
vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredentialField: vi.fn().mockResolvedValue("test-api-key"),
}));

function pinoLine(
  level: number,
  time: number,
  msg: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({ level, time, msg, ...extra });
}

function createMinimalAgentProject(tmpDir: string, agentName: string): void {
  const agentDir = join(tmpDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  const skillContent = `---
description: Test agent
models:
  - provider: openai
    model: gpt-4
    authType: api_key
credentials:
  - openai_key
---
# Test Agent
`;
  writeFileSync(join(agentDir, "SKILL.md"), skillContent);

  const configContent = `models = ["main"]
credentials = ["openai_key"]
`;
  writeFileSync(join(agentDir, "config.toml"), configContent);

  const globalConfigDir = tmpDir;
  const globalConfig = `[models.main]
provider = "openai"
model = "gpt-4"
authType = "api_key"
`;
  writeFileSync(join(globalConfigDir, "config.toml"), globalConfig);
}

function createTestApp(projectPath: string, statsStore?: any) {
  const app = new Hono();
  registerLogSummaryRoutes(app, projectPath, statsStore);
  return app;
}

function fakeOpenAIResponse(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    model: "gpt-4",
  };
}

describe("log summary route", () => {
  let tmpDir: string;
  let logsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-log-summary-test-"));
    logsPath = join(tmpDir, ".al", "logs");
    mkdirSync(logsPath, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid agent name", async () => {
    const app = createTestApp(tmpDir);
    const res = await app.request(
      "/api/logs/agents/INVALID_NAME/some-instance/summarize",
      { method: "POST" },
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid agent name/);
  });

  it("returns 400 for invalid instance ID", async () => {
    const app = createTestApp(tmpDir);
    const res = await app.request(
      "/api/logs/agents/my-agent/INVALID__ID/summarize",
      { method: "POST" },
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid instance ID/);
  });

  it("returns no-entries message when no log file exists", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const app = createTestApp(tmpDir);
    const res = await app.request(
      "/api/logs/agents/my-agent/some-instance/summarize",
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toMatch(/No log entries/);
    expect(data.cached).toBe(false);
  });

  it("returns no-entries message when log file exists but has no matching instance entries", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const lines = [
      pinoLine(30, 1710700000000, "msg-1", { instance: "other-instance" }),
      pinoLine(30, 1710700001000, "msg-2", { instance: "other-instance" }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      lines.join("\n") + "\n",
    );

    const app = createTestApp(tmpDir);
    const res = await app.request(
      "/api/logs/agents/my-agent/some-instance/summarize",
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toMatch(/No log entries/);
  });

  it("returns 500 when agent config cannot be loaded", async () => {
    // No agent directory created — config will fail to load
    const lines = [
      pinoLine(30, 1710700000000, "step 1", { instance: "inst-1" }),
    ];
    writeFileSync(
      join(logsPath, "no-agent-2024-03-18.log"),
      lines.join("\n") + "\n",
    );

    const app = createTestApp(tmpDir);
    const res = await app.request(
      "/api/logs/agents/no-agent/inst-1/summarize",
      { method: "POST" },
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Failed to load agent config/);
  });

  it("calls model and returns summary for matching log entries", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-abc";
    const lines = [
      pinoLine(30, 1710700000000, "Agent started", { instance: instanceId }),
      pinoLine(30, 1710700001000, "Running task", { instance: instanceId }),
      pinoLine(30, 1710700002000, "Task complete", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      lines.join("\n") + "\n",
    );

    // Mock fetch (used by OpenAIProvider)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("The agent started and completed a task successfully.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("The agent started and completed a task successfully.");
    expect(data.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches summary for completed runs", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-completed";
    const lines = [
      pinoLine(30, 1710700000000, "Done", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      lines.join("\n") + "\n",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("The agent completed.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Provide a statsStore that returns a completed run
    const statsStore = {
      queryRunByInstanceId: vi.fn().mockReturnValue({
        instanceId,
        result: "ok",
        agentName: "my-agent",
      }),
    } as any;

    const app = createTestApp(tmpDir, statsStore);

    // First call — should call the LLM
    const res1 = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.summary).toBe("The agent completed.");
    expect(data1.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();

    // Second call — should be served from cache
    const res2 = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.summary).toBe("The agent completed.");
    expect(data2.cached).toBe(true);
    // fetch should not have been called again
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not cache for in-progress runs", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-running";
    const lines = [
      pinoLine(30, 1710700000000, "Still going", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      lines.join("\n") + "\n",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("The agent is running.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    // statsStore returns null (run not in DB yet = in-progress)
    const statsStore = {
      queryRunByInstanceId: vi.fn().mockReturnValue(null),
    } as any;

    const app = createTestApp(tmpDir, statsStore);

    const res1 = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.cached).toBe(false);

    const res2 = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.cached).toBe(false);
    // Both calls should have hit the LLM
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
