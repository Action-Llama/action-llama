import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import openrouterKey from "../../../src/credentials/builtins/openrouter-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("openrouter_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(openrouterKey.id).toBe("openrouter_key");
    });

    it("has a single token field", () => {
      expect(openrouterKey.fields).toHaveLength(1);
      expect(openrouterKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(openrouterKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(openrouterKey.label).toBe("OpenRouter API Credential");
    });

    it("has a description mentioning OpenRouter", () => {
      expect(openrouterKey.description).toContain("OpenRouter");
    });

    it("has a custom prompt function", () => {
      expect(typeof openrouterKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("sk-or-test-key-123" as any);

        const result = await openrouterKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "sk-or-test-key-123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  sk-or-padded  " as any);

        const result = await openrouterKey.prompt!(undefined);

        expect(result!.values.token).toBe("sk-or-padded");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await openrouterKey.prompt!({ token: "sk-or-existing" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await openrouterKey.prompt!({ token: "sk-or-existing" });

        expect(result).toEqual({
          values: { token: "sk-or-existing" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("sk-or-new-key" as any);

        const result = await openrouterKey.prompt!({ token: "sk-or-old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "sk-or-new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-or-test";
        });

        await openrouterKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns error for input not starting with sk-or-", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-or-test";
        });

        await openrouterKey.prompt!(undefined);

        expect(capturedValidate!("sk-invalid")).toBe("API key should start with 'sk-or-'");
      });

      it("validate returns true for a valid sk-or- key", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-or-test";
        });

        await openrouterKey.prompt!(undefined);

        expect(capturedValidate!("sk-or-valid-key")).toBe(true);
      });

      it("validate trims before checking empty", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-or-test";
        });

        await openrouterKey.prompt!(undefined);

        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
