import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
}));

vi.mock("../../src/shared/credentials.js", () => ({
  loadCredentialFields: vi.fn(),
}));

import { confirm, input, password } from "@inquirer/prompts";
import { loadCredentialFields } from "../../src/shared/credentials.js";
import { promptCredential } from "../../src/credentials/prompter.js";
import type { CredentialDefinition } from "../../src/credentials/schema.js";

const mockedConfirm = vi.mocked(confirm);
const mockedInput = vi.mocked(input);
const mockedPassword = vi.mocked(password);
const mockedLoadCredentialFields = vi.mocked(loadCredentialFields);

function makeDef(overrides?: Partial<CredentialDefinition>): CredentialDefinition {
  return {
    id: "test_cred",
    label: "Test Credential",
    description: "A test credential",
    fields: [
      { name: "api_key", label: "API Key", description: "The API key", secret: true },
    ],
    ...overrides,
  };
}

describe("promptCredential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadCredentialFields.mockResolvedValue(undefined);
  });

  describe("custom prompt handler", () => {
    it("delegates to custom prompt() when provided", async () => {
      const customPrompt = vi.fn().mockResolvedValue({ values: { api_key: "custom-value" } });
      const def = makeDef({ prompt: customPrompt });

      const result = await promptCredential(def);

      expect(customPrompt).toHaveBeenCalledOnce();
      expect(result).toEqual({ values: { api_key: "custom-value" } });
    });

    it("passes existing values to custom prompt()", async () => {
      const existing = { api_key: "existing-key" };
      mockedLoadCredentialFields.mockResolvedValue(existing as any);
      const customPrompt = vi.fn().mockResolvedValue({ values: existing });
      const def = makeDef({ prompt: customPrompt });

      await promptCredential(def);

      expect(customPrompt).toHaveBeenCalledWith(existing);
    });

    it("passes undefined to custom prompt() when no existing values", async () => {
      mockedLoadCredentialFields.mockResolvedValue(undefined);
      const customPrompt = vi.fn().mockResolvedValue({ values: { api_key: "new" } });
      const def = makeDef({ prompt: customPrompt });

      await promptCredential(def);

      expect(customPrompt).toHaveBeenCalledWith(undefined);
    });

    it("uses provided instance name when loading existing values", async () => {
      const customPrompt = vi.fn().mockResolvedValue({ values: {} });
      const def = makeDef({ prompt: customPrompt });

      await promptCredential(def, "production");

      expect(mockedLoadCredentialFields).toHaveBeenCalledWith("test_cred", "production");
    });
  });

  describe("no existing values — default field prompting", () => {
    it("prompts for secret fields using password()", async () => {
      mockedPassword.mockResolvedValue("my-secret-key" as any);
      const def = makeDef({
        fields: [{ name: "api_key", label: "API Key", description: "", secret: true }],
      });

      const result = await promptCredential(def);

      expect(mockedPassword).toHaveBeenCalledOnce();
      expect(mockedInput).not.toHaveBeenCalled();
      expect(result).toEqual({ values: { api_key: "my-secret-key" } });
    });

    it("prompts for non-secret fields using input()", async () => {
      mockedInput.mockResolvedValue("my-username" as any);
      const def = makeDef({
        fields: [{ name: "username", label: "Username", description: "", secret: false }],
      });

      const result = await promptCredential(def);

      expect(mockedInput).toHaveBeenCalledOnce();
      expect(mockedPassword).not.toHaveBeenCalled();
      expect(result).toEqual({ values: { username: "my-username" } });
    });

    it("prompts for multiple fields in order", async () => {
      mockedInput.mockResolvedValueOnce("myuser" as any);
      mockedPassword.mockResolvedValueOnce("mysecret" as any);
      const def = makeDef({
        fields: [
          { name: "username", label: "Username", description: "", secret: false },
          { name: "token", label: "Token", description: "", secret: true },
        ],
      });

      const result = await promptCredential(def);

      expect(mockedInput).toHaveBeenCalledOnce();
      expect(mockedPassword).toHaveBeenCalledOnce();
      expect(result).toEqual({ values: { username: "myuser", token: "mysecret" } });
    });

    it("trims whitespace from field values and skips empty trimmed values", async () => {
      mockedInput.mockResolvedValue("  " as any);
      const def = makeDef({
        fields: [{ name: "username", label: "Username", description: "", secret: false }],
      });

      const result = await promptCredential(def);

      // Empty string after trim → not included in values
      expect(result).toEqual({ values: {} });
    });

    it("includes value when trimmed non-empty", async () => {
      mockedInput.mockResolvedValue("  trimmed-value  " as any);
      const def = makeDef({
        fields: [{ name: "key", label: "Key", description: "", secret: false }],
      });

      const result = await promptCredential(def);

      expect(result!.values.key).toBe("trimmed-value");
    });

    it("logs label and description to console", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockedPassword.mockResolvedValue("value" as any);
      const def = makeDef({ description: "My test description" });

      await promptCredential(def);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test Credential")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("My test description")
      );
      consoleSpy.mockRestore();
    });

    it("logs helpUrl when present", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockedPassword.mockResolvedValue("value" as any);
      const def = makeDef({ helpUrl: "https://example.com/docs" });

      await promptCredential(def);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("https://example.com/docs")
      );
      consoleSpy.mockRestore();
    });

    it("does not log helpUrl when absent", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockedPassword.mockResolvedValue("value" as any);
      const def = makeDef({ helpUrl: undefined });

      await promptCredential(def);

      const helpUrlLog = consoleSpy.mock.calls.some(call =>
        call.some(arg => typeof arg === "string" && arg.includes("http"))
      );
      expect(helpUrlLog).toBe(false);
      consoleSpy.mockRestore();
    });

    it("calls validate() after prompting all fields", async () => {
      const validate = vi.fn().mockResolvedValue(true);
      mockedPassword.mockResolvedValue("my-key" as any);
      const def = makeDef({ validate });

      await promptCredential(def);

      expect(validate).toHaveBeenCalledOnce();
      expect(validate).toHaveBeenCalledWith({ api_key: "my-key" });
    });

    it("returns result after validation without re-prompting", async () => {
      const validate = vi.fn().mockResolvedValue(true);
      mockedPassword.mockResolvedValue("my-key" as any);
      const def = makeDef({ validate });

      const result = await promptCredential(def);

      expect(result).toEqual({ values: { api_key: "my-key" } });
    });

    it("uses 'default' instance when none specified", async () => {
      mockedPassword.mockResolvedValue("value" as any);
      const def = makeDef();

      await promptCredential(def);

      expect(mockedLoadCredentialFields).toHaveBeenCalledWith("test_cred", "default");
    });
  });

  describe("existing values present — all optional fields covered", () => {
    it("asks to reuse existing credential", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(true as any);
      const def = makeDef();

      await promptCredential(def);

      expect(mockedConfirm).toHaveBeenCalledOnce();
      const call = mockedConfirm.mock.calls[0][0] as any;
      expect(call.default).toBe(true);
      expect(call.message).toContain("Test Credential");
    });

    it("returns existing values when user chooses to reuse", async () => {
      const existing = { api_key: "old-key" };
      mockedLoadCredentialFields.mockResolvedValue(existing as any);
      mockedConfirm.mockResolvedValue(true as any);
      const def = makeDef();

      const result = await promptCredential(def);

      expect(result).toEqual({ values: existing });
      expect(mockedPassword).not.toHaveBeenCalled();
    });

    it("falls through to field prompting when user declines reuse", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(false as any);
      mockedPassword.mockResolvedValue("new-key" as any);
      const def = makeDef();

      const result = await promptCredential(def);

      expect(mockedPassword).toHaveBeenCalledOnce();
      expect(result).toEqual({ values: { api_key: "new-key" } });
    });
  });

  describe("existing values present — missing optional fields", () => {
    it("asks to keep existing with count of missing optional fields", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(true as any);
      mockedInput.mockResolvedValue("extra-value" as any);
      const def = makeDef({
        fields: [
          { name: "api_key", label: "API Key", description: "", secret: true },
          { name: "extra", label: "Extra Field", description: "", secret: false, optional: true },
        ],
      });

      await promptCredential(def);

      expect(mockedConfirm).toHaveBeenCalledOnce();
      const call = mockedConfirm.mock.calls[0][0] as any;
      expect(call.message).toContain("1 new optional field");
    });

    it("merges existing with newly prompted optional fields when user accepts", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(true as any);
      mockedInput.mockResolvedValue("extra-value" as any);
      const def = makeDef({
        fields: [
          { name: "api_key", label: "API Key", description: "", secret: true },
          { name: "extra", label: "Extra Field", description: "", secret: false, optional: true },
        ],
      });

      const result = await promptCredential(def);

      expect(result!.values).toEqual({ api_key: "old-key", extra: "extra-value" });
    });

    it("uses plural wording when multiple missing optional fields", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(true as any);
      mockedInput.mockResolvedValue("v" as any).mockResolvedValue("v" as any);
      const def = makeDef({
        fields: [
          { name: "api_key", label: "API Key", description: "", secret: true },
          { name: "extra1", label: "Extra 1", description: "", secret: false, optional: true },
          { name: "extra2", label: "Extra 2", description: "", secret: false, optional: true },
        ],
      });

      await promptCredential(def);

      const call = mockedConfirm.mock.calls[0][0] as any;
      expect(call.message).toContain("2 new optional fields");
    });

    it("does not include empty trimmed optional values in merged result", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(true as any);
      mockedInput.mockResolvedValue("   " as any);
      const def = makeDef({
        fields: [
          { name: "api_key", label: "API Key", description: "", secret: true },
          { name: "extra", label: "Extra Field", description: "", secret: false, optional: true },
        ],
      });

      const result = await promptCredential(def);

      // empty trim → not added
      expect(result!.values).toEqual({ api_key: "old-key" });
    });

    it("falls through to full field prompting when user declines keeping existing", async () => {
      mockedLoadCredentialFields.mockResolvedValue({ api_key: "old-key" } as any);
      mockedConfirm.mockResolvedValue(false as any);
      mockedPassword.mockResolvedValue("brand-new-key" as any);
      mockedInput.mockResolvedValue("new-extra" as any);
      const def = makeDef({
        fields: [
          { name: "api_key", label: "API Key", description: "", secret: true },
          { name: "extra", label: "Extra Field", description: "", secret: false, optional: true },
        ],
      });

      const result = await promptCredential(def);

      expect(mockedPassword).toHaveBeenCalledOnce();
      expect(result!.values.api_key).toBe("brand-new-key");
    });
  });
});
