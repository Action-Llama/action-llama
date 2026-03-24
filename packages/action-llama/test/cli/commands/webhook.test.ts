import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { execute } from "../../../src/cli/commands/webhook.js";

// Mock console methods to capture output
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const mockConsoleWarn = vi.fn();

vi.spyOn(console, "log").mockImplementation(mockConsoleLog);
vi.spyOn(console, "error").mockImplementation(mockConsoleError);
vi.spyOn(console, "warn").mockImplementation(mockConsoleWarn);

describe("webhook command", () => {
  let tmpDir: string;
  let projectPath: string;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "webhook-test-"));
    projectPath = tmpDir;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  /** Create a per-agent SKILL.md + config.toml instead of [agents.<name>] in root config. */
  function createAgent(name: string, runtimeConfig: Record<string, unknown>) {
    const agentDir = resolve(projectPath, "agents", name);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "SKILL.md"), `---\n---\n\n# ${name}\n`);
    writeFileSync(join(agentDir, "config.toml"), stringifyTOML(runtimeConfig as any) + "\n");
  }

  describe("execute", () => {
    it("should throw error for unknown commands", async () => {
      await expect(execute("unknown", "fixture.json", { project: projectPath }))
        .rejects.toThrow("Unknown webhook command: unknown");
    });

    it("should handle missing fixture file", async () => {
      await expect(execute("replay", "nonexistent.json", { project: projectPath }))
        .rejects.toThrow("Failed to load fixture: file not found");
    });

    it("should handle invalid fixture format", async () => {
      const fixturePath = join(tmpDir, "invalid.json");
      writeFileSync(fixturePath, JSON.stringify({ invalid: true }));
      
      await expect(execute("replay", fixturePath, { project: projectPath }))
        .rejects.toThrow("Fixture must have 'headers' and 'body' properties");
    });

    it("should process GitHub webhook fixture successfully", async () => {
      // Create per-agent config
      createAgent("test-agent", {
        models: ["sonnet"],
        webhooks: [{ source: "github", events: ["issues"], actions: ["labeled"] }],
      });
      // Create project config.toml with webhook source
      const config = {
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: {
          github: {
            type: "github",
            secret: "test-secret"
          }
        }
      };
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML(config));

      // Create fixture
      const fixture = {
        headers: {
          "x-github-event": "issues",
          "x-github-delivery": "12345"
        },
        body: {
          action: "labeled",
          repository: {
            full_name: "owner/repo"
          },
          issue: {
            number: 123,
            title: "Test Issue",
            body: "Test body",
            html_url: "https://github.com/owner/repo/issues/123",
            user: {
              login: "author"
            },
            labels: [{ name: "bug" }]
          },
          sender: {
            login: "sender"
          }
        }
      };
      const fixturePath = join(tmpDir, "github-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { 
        project: projectPath, 
        source: "github"
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("🔍 Webhook Simulation Results")
      );
    });

    it("should work with explicit source parameter", async () => {
      // Create per-agent config
      createAgent("test-agent", {
        models: ["sonnet"],
        webhooks: [{ source: "github", events: ["issues"], actions: ["labeled"] }],
      });
      // Create project config.toml with models
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      }));

      // Create fixture
      const fixture = {
        headers: {
          "content-type": "application/json"
        },
        body: {
          action: "labeled",
          repository: {
            full_name: "owner/repo"
          },
          issue: {
            number: 123,
            title: "Test Issue",
            body: "Test body",
            html_url: "https://github.com/owner/repo/issues/123",
            user: {
              login: "author"
            },
            labels: [{ name: "bug" }]
          },
          sender: {
            login: "sender"
          }
        }
      };
      const fixturePath = join(tmpDir, "test-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { 
        project: projectPath, 
        source: "github" 
      });

      // Should show simulation results
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("🔍 Webhook Simulation Results")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("📡 Source: github")
      );
    });

    it("should handle simulate alias command", async () => {
      // Create minimal config (no agents needed for this test)
      mkdirSync(resolve(projectPath, "agents"), { recursive: true });

      // Create fixture
      const fixture = {
        headers: { "content-type": "application/json" },
        body: { test: true }
      };
      const fixturePath = join(tmpDir, "test-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("simulate", fixturePath, { 
        project: projectPath, 
        source: "test" 
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("🔍 Webhook Simulation Results")
      );
    });

    it("should show interactive run suggestion when --run is specified", async () => {
      // Create per-agent config with webhook trigger
      createAgent("matching-agent", {
        models: ["sonnet"],
        webhooks: [{ source: "test", events: ["test"] }],
      });
      // Create project config.toml with models
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      }));

      // Create fixture that will match
      const fixture = {
        headers: { "x-test-event": "test" },
        body: {
          event: "test",
          repository: { full_name: "test/repo" },
          sender: { login: "tester" }
        }
      };
      const fixturePath = join(tmpDir, "matching-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { 
        project: projectPath, 
        source: "test",
        run: true 
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("🚀 Interactive Run Mode")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("al run matching-agent")
      );
    });
  });
});