import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../../src/shared/paths.js", () => ({
  CREDENTIALS_DIR: "/fake/credentials",
}));

import { confirm, input, password, select } from "@inquirer/prompts";
import { existsSync, readFileSync } from "fs";
import gitSsh from "../../../src/credentials/builtins/id-rsa.js";

const mockedConfirm = vi.mocked(confirm);
const mockedInput = vi.mocked(input);
const mockedPassword = vi.mocked(password);
const mockedSelect = vi.mocked(select);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe("git_ssh credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(gitSsh.id).toBe("git_ssh");
    });

    it("has correct label", () => {
      expect(gitSsh.label).toBe("SSH Key & Git Identity");
    });

    it("has correct description", () => {
      expect(gitSsh.description).toContain("SSH private key");
    });

    it("has 3 fields", () => {
      expect(gitSsh.fields).toHaveLength(3);
    });

    it("has id_rsa field that is secret", () => {
      const field = gitSsh.fields.find((f) => f.name === "id_rsa");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has username field that is not secret", () => {
      const field = gitSsh.fields.find((f) => f.name === "username");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(false);
    });

    it("has email field that is not secret", () => {
      const field = gitSsh.fields.find((f) => f.name === "email");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(false);
    });

    it("has no envVars", () => {
      expect(gitSsh.envVars).toBeUndefined();
    });

    it("has agentContext referencing GIT_SSH_COMMAND", () => {
      expect(gitSsh.agentContext).toContain("GIT_SSH_COMMAND");
    });

    it("has a prompt function", () => {
      expect(typeof gitSsh.prompt).toBe("function");
    });
  });

  describe("prompt — reuse existing credentials", () => {
    it("returns existing values when user confirms reuse of all three fields", async () => {
      const existing = { id_rsa: "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----", username: "Alice", email: "alice@example.com" };
      mockedConfirm.mockResolvedValue(true as any);

      const result = await gitSsh.prompt!(existing);

      expect(result).toEqual({ values: existing });
    });

    it("asks with correct message when all fields exist", async () => {
      const existing = { id_rsa: "-----BEGIN RSA PRIVATE KEY-----\n...", username: "Alice", email: "alice@example.com" };
      mockedConfirm.mockResolvedValue(true as any);

      await gitSsh.prompt!(existing);

      expect(mockedConfirm).toHaveBeenCalledOnce();
      const call = mockedConfirm.mock.calls[0][0] as any;
      expect(call.message).toContain("Alice");
      expect(call.message).toContain("alice@example.com");
    });

    it("does not ask to reuse when id_rsa is missing", async () => {
      // Without id_rsa, skip the main reuse prompt (the first confirm)
      // But it will ask for username and then check existing SSH key
      mockedInput
        .mockResolvedValueOnce("Bob" as any)    // username
        .mockResolvedValueOnce("bob@example.com" as any); // email
      mockedConfirm.mockResolvedValue(false as any); // existing SSH key prompt (skip because id_rsa missing)
      mockedSelect.mockResolvedValue("skip" as any);

      const result = await gitSsh.prompt!({ username: "Bob", email: "bob@example.com" });

      // The main reuse prompt should NOT have been called (no id_rsa, username, email check all required)
      // Actually based on the code: if existing?.id_rsa && existing?.username && existing?.email
      // All three are needed to trigger the global reuse prompt
      expect(result.values).toEqual({ username: "Bob", email: "bob@example.com" });
    });
  });

  describe("prompt — choose not to reuse, skip SSH key", () => {
    it("returns username and email without SSH key when skip is chosen", async () => {
      mockedConfirm.mockResolvedValue(false as any); // don't reuse existing
      mockedInput
        .mockResolvedValueOnce("Charlie" as any)   // username
        .mockResolvedValueOnce("charlie@test.com" as any); // email
      // No existing SSH key since we said don't reuse
      mockedSelect.mockResolvedValue("skip" as any);

      const result = await gitSsh.prompt!({ id_rsa: "existing-key", username: "Old", email: "old@test.com" });

      expect(result.values).toEqual({ username: "Charlie", email: "charlie@test.com" });
      expect(result.values.id_rsa).toBeUndefined();
    });
  });

  describe("prompt — no existing credentials", () => {
    it("returns values with SSH key from file", async () => {
      // No existing credentials
      mockedInput
        .mockResolvedValueOnce("Dave" as any)     // username
        .mockResolvedValueOnce("dave@test.com" as any); // email
      mockedSelect.mockResolvedValue("file" as any);
      mockedInput.mockResolvedValueOnce("/home/dave/.ssh/id_rsa" as any); // key path

      mockedExistsSync.mockImplementation((p: any) => {
        if (p === "/home/dave/.ssh/id_rsa") return true;
        return false;
      });
      mockedReadFileSync.mockReturnValue("-----BEGIN RSA PRIVATE KEY-----\nMOCKED\n-----END RSA PRIVATE KEY-----" as any);

      const result = await gitSsh.prompt!({});

      expect(result.values.username).toBe("Dave");
      expect(result.values.email).toBe("dave@test.com");
      expect(result.values.id_rsa).toContain("MOCKED");
    });

    it("throws when SSH key file does not exist", async () => {
      mockedInput
        .mockResolvedValueOnce("Eve" as any)
        .mockResolvedValueOnce("eve@test.com" as any);
      mockedSelect.mockResolvedValue("file" as any);
      mockedInput.mockResolvedValueOnce("/nonexistent/id_rsa" as any);

      mockedExistsSync.mockReturnValue(false as any);

      await expect(gitSsh.prompt!({})).rejects.toThrow("SSH key not found at");
    });

    it("returns values with pasted SSH key", async () => {
      mockedInput
        .mockResolvedValueOnce("Frank" as any)
        .mockResolvedValueOnce("frank@test.com" as any);
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("  -----BEGIN RSA PRIVATE KEY-----\nPASTED\n-----END RSA PRIVATE KEY-----  " as any);

      const result = await gitSsh.prompt!({});

      expect(result.values.username).toBe("Frank");
      expect(result.values.email).toBe("frank@test.com");
      // key is trimmed
      expect(result.values.id_rsa).toBe("-----BEGIN RSA PRIVATE KEY-----\nPASTED\n-----END RSA PRIVATE KEY-----");
    });
  });

  describe("prompt — existing SSH key reuse", () => {
    it("reuses existing SSH key when user declines to provide a new one", async () => {
      // Reuse the global credentials
      mockedConfirm
        .mockResolvedValueOnce(false as any) // don't reuse full credential
        .mockResolvedValueOnce(true as any);  // keep existing SSH key
      mockedInput
        .mockResolvedValueOnce("Updated Name" as any)
        .mockResolvedValueOnce("updated@test.com" as any);

      const existing = { id_rsa: "-----BEGIN RSA PRIVATE KEY-----\nEXISTING\n-----END RSA PRIVATE KEY-----", username: "Old", email: "old@test.com" };
      const result = await gitSsh.prompt!(existing);

      expect(result.values.id_rsa).toBe(existing.id_rsa);
      expect(result.values.username).toBe("Updated Name");
      expect(result.values.email).toBe("updated@test.com");
    });
  });
});
