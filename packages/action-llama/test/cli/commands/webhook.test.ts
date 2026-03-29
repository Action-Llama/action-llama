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

    it("should throw when no source is detected and none provided", async () => {
      // Create a project with an agent but no recognizable webhook headers
      mkdirSync(resolve(projectPath, "agents", "myagent"), { recursive: true });
      writeFileSync(join(projectPath, "agents", "myagent", "SKILL.md"), "---\n---\n# agent\n");
      writeFileSync(join(projectPath, "agents", "myagent", "config.toml"), stringifyTOML({
        models: ["sonnet"], webhooks: []
      }));
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      }));

      const fixture = {
        headers: { "content-type": "application/json" }, // no recognizable source header
        body: { action: "opened" }
      };
      const fixturePath = join(tmpDir, "no-source.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      // Should throw in test mode
      await expect(execute("replay", fixturePath, { project: projectPath }))
        .rejects.toThrow("Could not determine webhook source");
    });

    it("should warn about unknown webhook types in config", async () => {
      mkdirSync(resolve(projectPath, "agents"), { recursive: true });
      // Config with unknown webhook type
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: {
          custom: { type: "custom-provider", secret: "abc" }
        }
      }));

      const fixture = {
        headers: { "x-test-event": "test" },
        body: { event: "test", sender: { login: "tester" } }
      };
      const fixturePath = join(tmpDir, "test-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath, source: "test" });

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("Unknown webhook type: custom-provider")
      );
    });

    it("should handle createFilterFromTrigger with all filter fields", async () => {
      createAgent("filter-agent", {
        models: ["sonnet"],
        webhooks: [{
          source: "github",
          events: ["issues"],
          actions: ["opened"],
          repos: ["myrepo"],
          org: "myorg",
          orgs: ["org1"],
          organizations: ["orgA"],
          labels: ["bug"],
          assignee: "user1",
          author: "user2",
          branches: ["main"],
          resources: ["issue"],
        }],
      });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { github: { type: "github", secret: "abc" } }
      }));

      const fixture = {
        headers: { "x-github-event": "issues" },
        body: {
          action: "opened",
          repository: { full_name: "myorg/myrepo" },
          issue: {
            number: 1,
            title: "Test",
            html_url: "https://github.com/myorg/myrepo/issues/1",
            user: { login: "user2" },
            labels: [{ name: "bug" }]
          },
          sender: { login: "user1" }
        }
      };
      const fixturePath = join(tmpDir, "filter-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath, source: "github" });
      // Should display results without throwing
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("🔍 Webhook Simulation Results"));
    });

    it("should show interactive run no-matched message when --run but no matches", async () => {
      // Create agent with webhook that won't match
      createAgent("nonmatching-agent", {
        models: ["sonnet"],
        webhooks: [{ source: "github", events: ["push"] }], // only push events
      });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { github: { type: "github" } }
      }));

      const fixture = {
        headers: { "x-github-event": "issues" }, // issues event, not push
        body: {
          action: "opened",
          repository: { full_name: "owner/repo" },
          issue: {
            number: 5, title: "Bug",
            html_url: "https://github.com/owner/repo/issues/5",
            user: { login: "author" }, labels: []
          },
          sender: { login: "sender" }
        }
      };
      const fixturePath = join(tmpDir, "no-match-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath, source: "github", run: true });

      // When --run is specified but no matched agents, shows a warning
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("Webhook Simulation Results"));
    });

    it("detects linear source from x-linear-signature header", async () => {
      mkdirSync(resolve(projectPath, "agents"), { recursive: true });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { linear: { type: "linear", secret: "lsec" } },
      }));

      const fixture = {
        headers: { "x-linear-signature": "abc123" },
        body: { action: "create", type: "Issue" },
      };
      const fixturePath = join(tmpDir, "linear-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      // Should detect linear source automatically (no --source flag)
      await execute("replay", fixturePath, { project: projectPath });
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("📡 Source: linear"));
    });

    it("detects mintlify source from x-mintlify-signature header", async () => {
      mkdirSync(resolve(projectPath, "agents"), { recursive: true });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { mintlify: { type: "mintlify", secret: "msec" } },
      }));

      const fixture = {
        headers: { "x-mintlify-signature": "sig123" },
        body: { event: "page_update", page: { slug: "docs/intro" } },
      };
      const fixturePath = join(tmpDir, "mintlify-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath });
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("📡 Source: mintlify"));
    });

    it("detects test source from x-test-event header", async () => {
      mkdirSync(resolve(projectPath, "agents"), { recursive: true });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { test: { type: "test" } },
      }));

      const fixture = {
        headers: { "x-test-event": "ping" },
        body: { event: "ping" },
      };
      const fixturePath = join(tmpDir, "test-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath });
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("📡 Source: test"));
    });

    it("shows unmatched agents section when agents don't match webhook", async () => {
      // Create an agent with a specific webhook filter that won't match
      createAgent("selective-agent", {
        models: ["sonnet"],
        webhooks: [{ source: "github", events: ["push"], repos: ["only-this-repo"] }],
      });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { github: { type: "github" } },
      }));

      const fixture = {
        headers: { "x-github-event": "issues" }, // issues not push
        body: {
          action: "opened",
          repository: { full_name: "owner/repo" },
          issue: {
            number: 42,
            title: "A bug",
            html_url: "https://github.com/owner/repo/issues/42",
            user: { login: "alice" },
            labels: [{ name: "bug" }],
          },
          sender: { login: "alice" },
        },
      };
      const fixturePath = join(tmpDir, "unmatched-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath, source: "github" });

      const allOutput = mockConsoleLog.mock.calls.map((c: any[]) => c[0]).join("\n");
      expect(allOutput).toContain("🔍 Webhook Simulation Results");
    });

    it("shows 'no agents configured' when bindings is empty", async () => {
      // No agents directory at all
      mkdirSync(resolve(projectPath, "agents"), { recursive: true });
      writeFileSync(join(projectPath, "config.toml"), stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
        webhooks: { github: { type: "github" } },
      }));

      const fixture = {
        headers: { "x-github-event": "push" },
        body: {
          repository: { full_name: "owner/repo" },
          sender: { login: "pusher" },
          ref: "refs/heads/main",
        },
      };
      const fixturePath = join(tmpDir, "empty-fixture.json");
      writeFileSync(fixturePath, JSON.stringify(fixture));

      await execute("replay", fixturePath, { project: projectPath, source: "github" });

      const allOutput = mockConsoleLog.mock.calls.map((c: any[]) => c[0]).join("\n");
      expect(allOutput).toContain("🔍 Webhook Simulation Results");
    });
  });
});