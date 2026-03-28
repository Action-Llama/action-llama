import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock credentials before importing the module under test
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: vi.fn((ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep), instance: ref.slice(sep + 1) };
  }),
  loadCredentialField: vi.fn(),
}));

import { GitEnvironment } from "../../src/agents/git-environment.js";
import { parseCredentialRef, loadCredentialField } from "../../src/shared/credentials.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("GitEnvironment", () => {
  let env: GitEnvironment;

  // Save original env vars to restore after each test
  const GIT_KEYS = [
    "GIT_AUTHOR_NAME",
    "GIT_COMMITTER_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_EMAIL",
  ] as const;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = new GitEnvironment(mockLogger as any);

    // Save original values
    originalEnv = {};
    for (const key of GIT_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original values
    for (const key of GIT_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  describe("setup", () => {
    it("returns the current git env vars as SavedEnv", async () => {
      process.env.GIT_AUTHOR_NAME = "original-author";
      const saved = await env.setup([]);
      expect(saved.GIT_AUTHOR_NAME).toBe("original-author");
    });

    it("returns undefined for unset env vars", async () => {
      const saved = await env.setup([]);
      expect(saved.GIT_AUTHOR_NAME).toBeUndefined();
    });

    it("does not modify env vars when no git_ssh credential is in the list", async () => {
      process.env.GIT_AUTHOR_NAME = "original";
      await env.setup(["github_token"]);
      expect(process.env.GIT_AUTHOR_NAME).toBe("original");
    });

    it("sets git author name from git_ssh credential when username is loaded", async () => {
      vi.mocked(loadCredentialField).mockImplementation(async (type, instance, field) => {
        if (type === "git_ssh" && field === "username") return "bot-user";
        if (type === "git_ssh" && field === "email") return undefined;
        return undefined;
      });

      await env.setup(["git_ssh"]);

      expect(process.env.GIT_AUTHOR_NAME).toBe("bot-user");
      expect(process.env.GIT_COMMITTER_NAME).toBe("bot-user");
    });

    it("sets git author email from git_ssh credential when email is loaded", async () => {
      vi.mocked(loadCredentialField).mockImplementation(async (type, instance, field) => {
        if (type === "git_ssh" && field === "username") return undefined;
        if (type === "git_ssh" && field === "email") return "bot@example.com";
        return undefined;
      });

      await env.setup(["git_ssh"]);

      expect(process.env.GIT_AUTHOR_EMAIL).toBe("bot@example.com");
      expect(process.env.GIT_COMMITTER_EMAIL).toBe("bot@example.com");
    });

    it("sets both name and email when both are available", async () => {
      vi.mocked(loadCredentialField).mockImplementation(async (type, instance, field) => {
        if (type === "git_ssh" && field === "username") return "mybot";
        if (type === "git_ssh" && field === "email") return "mybot@test.com";
        return undefined;
      });

      await env.setup(["git_ssh"]);

      expect(process.env.GIT_AUTHOR_NAME).toBe("mybot");
      expect(process.env.GIT_COMMITTER_NAME).toBe("mybot");
      expect(process.env.GIT_AUTHOR_EMAIL).toBe("mybot@test.com");
      expect(process.env.GIT_COMMITTER_EMAIL).toBe("mybot@test.com");
    });

    it("uses scoped instance when git_ssh ref includes an instance", async () => {
      vi.mocked(loadCredentialField).mockImplementation(async (type, instance, field) => {
        if (type === "git_ssh" && instance === "mybot" && field === "username") return "mybot-user";
        if (type === "git_ssh" && instance === "mybot" && field === "email") return "mybot@example.com";
        return undefined;
      });

      await env.setup(["git_ssh:mybot"]);

      expect(process.env.GIT_AUTHOR_NAME).toBe("mybot-user");
    });

    it("logs a warning and does not throw when credential loading fails", async () => {
      vi.mocked(loadCredentialField).mockRejectedValue(new Error("credential not found"));

      await expect(env.setup(["git_ssh"])).resolves.toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("does not set env vars when credential fields return undefined", async () => {
      vi.mocked(loadCredentialField).mockResolvedValue(undefined);

      await env.setup(["git_ssh"]);

      expect(process.env.GIT_AUTHOR_NAME).toBeUndefined();
      expect(process.env.GIT_AUTHOR_EMAIL).toBeUndefined();
    });
  });

  describe("restore", () => {
    it("restores previously set env vars", () => {
      process.env.GIT_AUTHOR_NAME = "changed";
      env.restore({ GIT_AUTHOR_NAME: "original" });
      expect(process.env.GIT_AUTHOR_NAME).toBe("original");
    });

    it("deletes env vars that were originally undefined", () => {
      process.env.GIT_AUTHOR_NAME = "was-set";
      env.restore({ GIT_AUTHOR_NAME: undefined });
      expect(process.env.GIT_AUTHOR_NAME).toBeUndefined();
    });

    it("restores all four git env vars", () => {
      process.env.GIT_AUTHOR_NAME = "a";
      process.env.GIT_COMMITTER_NAME = "b";
      process.env.GIT_AUTHOR_EMAIL = "c";
      process.env.GIT_COMMITTER_EMAIL = "d";

      env.restore({
        GIT_AUTHOR_NAME: "orig-a",
        GIT_COMMITTER_NAME: "orig-b",
        GIT_AUTHOR_EMAIL: "orig-c",
        GIT_COMMITTER_EMAIL: "orig-d",
      });

      expect(process.env.GIT_AUTHOR_NAME).toBe("orig-a");
      expect(process.env.GIT_COMMITTER_NAME).toBe("orig-b");
      expect(process.env.GIT_AUTHOR_EMAIL).toBe("orig-c");
      expect(process.env.GIT_COMMITTER_EMAIL).toBe("orig-d");
    });

    it("setup → restore round-trip preserves original state", async () => {
      process.env.GIT_AUTHOR_NAME = "pre-existing";
      vi.mocked(loadCredentialField).mockResolvedValue("bot-user");

      const saved = await env.setup(["git_ssh"]);
      expect(process.env.GIT_AUTHOR_NAME).toBe("bot-user");

      env.restore(saved);
      expect(process.env.GIT_AUTHOR_NAME).toBe("pre-existing");
    });
  });
});
