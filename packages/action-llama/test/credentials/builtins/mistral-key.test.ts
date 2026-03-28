import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import mistralKey from "../../../src/credentials/builtins/mistral-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("mistral_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(mistralKey.id).toBe("mistral_key");
    });

    it("has a single token field", () => {
      expect(mistralKey.fields).toHaveLength(1);
      expect(mistralKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(mistralKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(mistralKey.label).toBe("Mistral AI API Credential");
    });

    it("has a description", () => {
      expect(typeof mistralKey.description).toBe("string");
      expect(mistralKey.description.length).toBeGreaterThan(0);
    });

    it("has a custom prompt function", () => {
      expect(typeof mistralKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("mistral-test-key-123" as any);

        const result = await mistralKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "mistral-test-key-123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  mistral-padded-key  " as any);

        const result = await mistralKey.prompt!(undefined);

        expect(result!.values.token).toBe("mistral-padded-key");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await mistralKey.prompt!({ token: "mistral-existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await mistralKey.prompt!({ token: "mistral-existing-key" });

        expect(result).toEqual({
          values: { token: "mistral-existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("mistral-new-key" as any);

        const result = await mistralKey.prompt!({ token: "mistral-old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "mistral-new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "mistral-test";
        });

        await mistralKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns true for non-empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "mistral-test";
        });

        await mistralKey.prompt!(undefined);

        expect(capturedValidate!("any-valid-key")).toBe(true);
      });

      it("validate trims before checking empty", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "mistral-test";
        });

        await mistralKey.prompt!(undefined);

        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
