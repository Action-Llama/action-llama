import { describe, it, expect, vi, afterEach } from "vitest";
import { VERSION, GIT_SHA, imageTags, CONSTANTS } from "../../src/shared/constants.js";

// Hoisted mocks for fs and child_process so we can re-evaluate constants.js in isolation
const { mockReadFileSync, mockExecFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockExecFileSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  // Default: forward all calls to real readFileSync
  mockReadFileSync.mockImplementation((...args: Parameters<typeof actual.readFileSync>) =>
    (actual.readFileSync as any)(...args)
  );
  return { ...actual, readFileSync: mockReadFileSync };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  // Default: forward calls to the real execFileSync
  mockExecFileSync.mockImplementation((...args: Parameters<typeof actual.execFileSync>) =>
    actual.execFileSync(...args)
  );
  return { ...actual, execFileSync: mockExecFileSync };
});

describe("VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});

describe("GIT_SHA", () => {
  it("is a non-empty string", () => {
    expect(typeof GIT_SHA).toBe("string");
    expect(GIT_SHA.length).toBeGreaterThan(0);
  });
});

describe("imageTags", () => {
  it("returns an array with primary tag (git SHA), version tag, and latest", () => {
    const tags = imageTags("my-image");
    expect(tags).toHaveLength(3);
    expect(tags[0]).toMatch(/^my-image:/);
    expect(tags[1]).toBe(`my-image:${VERSION}`);
    expect(tags[2]).toBe("my-image:latest");
  });

  it("primary tag contains the GIT_SHA", () => {
    const tags = imageTags("al-agent");
    expect(tags[0]).toBe(`al-agent:${GIT_SHA}`);
  });
});

describe("CONSTANTS", () => {
  describe("static fields", () => {
    it("DEFAULT_SECRET_PREFIX is 'action-llama'", () => {
      expect(CONSTANTS.DEFAULT_SECRET_PREFIX).toBe("action-llama");
    });

    it("STARTED_BY is 'action-llama'", () => {
      expect(CONSTANTS.STARTED_BY).toBe("action-llama");
    });

    it("CONTAINER_FILTER is 'al-'", () => {
      expect(CONSTANTS.CONTAINER_FILTER).toBe("al-");
    });

    it("NETWORK_NAME is 'al-net'", () => {
      expect(CONSTANTS.NETWORK_NAME).toBe("al-net");
    });

    it("DEFAULT_IMAGE includes GIT_SHA", () => {
      expect(CONSTANTS.DEFAULT_IMAGE).toBe(`al-agent:${GIT_SHA}`);
    });

    it("PROJECT_BASE_IMAGE includes GIT_SHA", () => {
      expect(CONSTANTS.PROJECT_BASE_IMAGE).toBe(`al-project-base:${GIT_SHA}`);
    });

    it("SCHEDULER_IMAGE includes GIT_SHA", () => {
      expect(CONSTANTS.SCHEDULER_IMAGE).toBe(`al-scheduler:${GIT_SHA}`);
    });

    it("CONTAINER_UID is 1000", () => {
      expect(CONSTANTS.CONTAINER_UID).toBe(1000);
    });

    it("CONTAINER_GID is 1000", () => {
      expect(CONSTANTS.CONTAINER_GID).toBe(1000);
    });
  });

  describe("agentFamily", () => {
    it("prefixes agent name with 'al-'", () => {
      expect(CONSTANTS.agentFamily("my-agent")).toBe("al-my-agent");
    });

    it("works with any string name", () => {
      expect(CONSTANTS.agentFamily("fix-bug")).toBe("al-fix-bug");
    });
  });

  describe("agentNameFromFamily", () => {
    it("strips the 'al-' prefix from a family name", () => {
      expect(CONSTANTS.agentNameFromFamily("al-my-agent")).toBe("my-agent");
    });

    it("returns the family as-is when it does not start with 'al-'", () => {
      expect(CONSTANTS.agentNameFromFamily("my-agent")).toBe("my-agent");
    });

    it("strips only the first 'al-' prefix", () => {
      expect(CONSTANTS.agentNameFromFamily("al-al-nested")).toBe("al-nested");
    });
  });

  describe("containerName", () => {
    it("builds a container name with 'al-' prefix, agent name, and run ID", () => {
      expect(CONSTANTS.containerName("my-agent", "abc123")).toBe("al-my-agent-abc123");
    });

    it("includes the runId in the output", () => {
      const name = CONSTANTS.containerName("worker", "run-42");
      expect(name).toBe("al-worker-run-42");
    });
  });

  describe("agentImage", () => {
    it("returns agent-specific image tag with GIT_SHA", () => {
      expect(CONSTANTS.agentImage("my-agent")).toBe(`al-my-agent:${GIT_SHA}`);
    });
  });

  describe("CREDS_DIR_MODE", () => {
    it("is a number", () => {
      expect(typeof CONSTANTS.CREDS_DIR_MODE).toBe("number");
    });
  });

  describe("CREDS_FILE_MODE", () => {
    it("is a number", () => {
      expect(typeof CONSTANTS.CREDS_FILE_MODE).toBe("number");
    });
  });
});

describe("getGitSha — build-info.json path", () => {
  afterEach(() => {
    vi.resetModules();
    // Restore default mock implementations
    mockReadFileSync.mockImplementation(undefined as any);
    mockExecFileSync.mockImplementation(undefined as any);
  });

  it("returns gitSha from build-info.json when the file exists and contains a valid gitSha", async () => {
    const MOCK_GIT_SHA = "abc12345";

    // Mock readFileSync: return real data for package.json, mocked data for build-info.json
    mockReadFileSync.mockImplementation((...args: any[]) => {
      const path = String(args[0]);
      if (path.endsWith("build-info.json")) {
        return JSON.stringify({ gitSha: MOCK_GIT_SHA });
      }
      // Delegate to the real fs for anything else (e.g. package.json)
      const { readFileSync: realReadFileSync } = require("fs");
      return realReadFileSync(...args);
    });

    vi.resetModules();
    const { GIT_SHA: freshGitSha } = await import("../../src/shared/constants.js");
    expect(freshGitSha).toBe(MOCK_GIT_SHA);
  });
});

describe("CONSTANTS — non-test NODE_ENV", () => {
  afterEach(() => {
    vi.resetModules();
    mockReadFileSync.mockImplementation(undefined as any);
  });

  it("uses restrictive CREDS_DIR_MODE (0o700) when NODE_ENV is not 'test'", async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // Forward readFileSync to the real implementation
    mockReadFileSync.mockImplementation((...args: any[]) => {
      const { readFileSync: realReadFileSync } = require("fs");
      return realReadFileSync(...args);
    });

    vi.resetModules();
    const { CONSTANTS: freshConstants } = await import("../../src/shared/constants.js");
    expect(freshConstants.CREDS_DIR_MODE).toBe(0o700);
    expect(freshConstants.CREDS_FILE_MODE).toBe(0o400);

    process.env.NODE_ENV = savedNodeEnv;
  });
});
