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

// Mock config module with passthrough so loadGlobalConfig can be overridden per-test
vi.mock("../../../src/shared/config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/shared/config.js")>();
  return {
    ...real,
    loadGlobalConfig: vi.fn((...args: Parameters<typeof real.loadGlobalConfig>) =>
      real.loadGlobalConfig(...args)
    ),
  };
});

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

  it("returns 500 when project config cannot be loaded", async () => {
    // Mock loadGlobalConfig to throw an error simulating a broken config file
    const configModule = await import("../../../src/shared/config.js");
    vi.mocked(configModule.loadGlobalConfig).mockImplementationOnce(() => {
      throw new Error("Error parsing config.toml: unexpected token");
    });

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
    expect(data.error).toMatch(/Failed to load project config/);
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

  it("returns 400 for invalid grep regex pattern", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-grep";
    const lines = [
      pinoLine(30, 1710700000000, "msg", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      lines.join("\n") + "\n",
    );

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize?grep=%5B`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid grep pattern/);
  });

  it("clamps lines param to MAX_LINES when it exceeds the limit", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-lines";
    const logLines = [
      pinoLine(30, 1710700000000, "step 1", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      logLines.join("\n") + "\n",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("Clamped lines summary.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    // lines=99999 far exceeds MAX_LINES (2000), should be clamped and still work
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize?lines=99999`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("Clamped lines summary.");
  });

  it("returns 500 when project config has no models defined", async () => {
    // Create a project with no models in the global config.toml
    const agentName = "no-models-agent";
    writeFileSync(
      join(tmpDir, "config.toml"),
      `# no models defined\n`,
    );

    const instanceId = "inst-nomodel";
    const logLines = [
      pinoLine(30, 1710700000000, "running", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, `${agentName}-2024-03-18.log`),
      logLines.join("\n") + "\n",
    );

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/${agentName}/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("No models configured in project config");
  });

  it("returns 500 with 'No models configured in project config' when loadGlobalConfig returns empty models", async () => {
    // This test covers the defensive check in log-summary.ts where
    // globalConfig.models is empty. We mock loadGlobalConfig to return an empty models map.
    const configModule = await import("../../../src/shared/config.js");
    vi.mocked(configModule.loadGlobalConfig).mockReturnValueOnce({
      models: {},
    } as any);

    const instanceId = "inst-empty-models-check";
    const logLines = [
      pinoLine(30, 1710700000000, "running", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      logLines.join("\n") + "\n",
    );

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("No models configured in project config");
  });

  it("returns 500 when the LLM call fails", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-llm-fail";
    const logLines = [
      pinoLine(30, 1710700000000, "something happened", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-18.log"),
      logLines.join("\n") + "\n",
    );

    // Mock fetch to simulate API failure
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Failed to generate summary/);
  });

  it("uses anthropic provider when agent model is configured as anthropic", async () => {
    // Create agent config with anthropic provider
    const agentName = "anthropic-agent";
    const agentDir = join(tmpDir, "agents", agentName);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "SKILL.md"),
      `---\ndescription: Anthropic agent\n---\n# Anthropic Agent\n`,
    );
    writeFileSync(
      join(agentDir, "config.toml"),
      `models = ["main"]\n`,
    );
    writeFileSync(
      join(tmpDir, "config.toml"),
      `[models.main]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n`,
    );

    const instanceId = "inst-anthropic";
    const logLines = [
      pinoLine(30, 1710700000000, "claude ran", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, `${agentName}-2024-03-18.log`),
      logLines.join("\n") + "\n",
    );

    // Mock fetch to return Anthropic-format response
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Anthropic summary result." }],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 30 },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/${agentName}/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("Anthropic summary result.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses custom provider when agent model provider is not openai or anthropic", async () => {
    // Create agent config with a custom/openrouter provider
    const agentName = "custom-agent";
    const agentDir = join(tmpDir, "agents", agentName);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "SKILL.md"),
      `---\ndescription: Custom provider agent\n---\n# Custom Agent\n`,
    );
    writeFileSync(
      join(agentDir, "config.toml"),
      `models = ["main"]\n`,
    );
    writeFileSync(
      join(tmpDir, "config.toml"),
      `[models.main]\nprovider = "openrouter"\nmodel = "meta-llama/llama-3-8b-instruct"\nauthType = "api_key"\nbaseUrl = "https://openrouter.ai/api/v1"\n`,
    );

    const instanceId = "inst-custom";
    const logLines = [
      pinoLine(30, 1710700000000, "custom ran", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, `${agentName}-2024-03-18.log`),
      logLines.join("\n") + "\n",
    );

    // Custom provider uses OpenAI-compatible API — mock fetch accordingly
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("Custom provider summary.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/${agentName}/${instanceId}/summarize`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("Custom provider summary.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to empty API key when loadCredentialField throws", async () => {
    const { loadCredentialField } = await import("../../../src/shared/credentials.js");
    vi.mocked(loadCredentialField).mockRejectedValueOnce(new Error("Credential store unavailable"));

    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-cred-fail";
    const logLines = [
      pinoLine(30, 1710700000000, "step 1", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-20.log"),
      logLines.join("\n") + "\n",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("Summary with empty key.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize`,
      { method: "POST" },
    );
    // Even when credential loading fails, the request should succeed (empty API key is allowed)
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("Summary with empty key.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("applies grep filter to log entries before summarizing", async () => {
    createMinimalAgentProject(tmpDir, "my-agent");
    const instanceId = "inst-grep-ok";
    const logLines = [
      pinoLine(30, 1710700000000, "error occurred", { instance: instanceId }),
      pinoLine(30, 1710700001000, "normal log", { instance: instanceId }),
      pinoLine(30, 1710700002000, "another error", { instance: instanceId }),
    ];
    writeFileSync(
      join(logsPath, "my-agent-2024-03-19.log"),
      logLines.join("\n") + "\n",
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeOpenAIResponse("Grep-filtered summary.")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = createTestApp(tmpDir);
    const res = await app.request(
      `/api/logs/agents/my-agent/${instanceId}/summarize?grep=error`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("Grep-filtered summary.");
    // The fetch was called — meaning entries were found and summarized
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
