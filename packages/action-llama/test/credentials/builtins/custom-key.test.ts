import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import customKey from "../../../src/credentials/builtins/custom-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("custom_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(customKey.id).toBe("custom_key");
    });

    it("has a single token field", () => {
      expect(customKey.fields).toHaveLength(1);
      expect(customKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(customKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(customKey.label).toBe("Custom LLM Provider API Credential");
    });

    it("has a description", () => {
      expect(typeof customKey.description).toBe("string");
      expect(customKey.description.length).toBeGreaterThan(0);
    });

    it("has a custom prompt function", () => {
      expect(typeof customKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("custom-test-key-abc123" as any);

        const result = await customKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "custom-test-key-abc123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  custom-padded-key  " as any);

        const result = await customKey.prompt!(undefined);

        expect(result!.values.token).toBe("custom-padded-key");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await customKey.prompt!({ token: "custom-existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await customKey.prompt!({ token: "custom-existing-key" });

        expect(result).toEqual({
          values: { token: "custom-existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("custom-new-key" as any);

        const result = await customKey.prompt!({ token: "custom-old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "custom-new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "custom-test";
        });

        await customKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns true for non-empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "custom-test";
        });

        await customKey.prompt!(undefined);

        expect(capturedValidate!("any-custom-key-value")).toBe(true);
      });

      it("validate trims before checking empty", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "custom-test";
        });

        await customKey.prompt!(undefined);

        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
