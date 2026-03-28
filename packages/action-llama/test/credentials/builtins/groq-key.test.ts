import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import groqKey from "../../../src/credentials/builtins/groq-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("groq_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(groqKey.id).toBe("groq_key");
    });

    it("has a single token field", () => {
      expect(groqKey.fields).toHaveLength(1);
      expect(groqKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(groqKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(groqKey.label).toBe("Groq API Credential");
    });

    it("has a description", () => {
      expect(typeof groqKey.description).toBe("string");
      expect(groqKey.description.length).toBeGreaterThan(0);
    });

    it("has a custom prompt function", () => {
      expect(typeof groqKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("gsk_test-key-123" as any);

        const result = await groqKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "gsk_test-key-123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  gsk_padded-key  " as any);

        const result = await groqKey.prompt!(undefined);

        expect(result!.values.token).toBe("gsk_padded-key");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await groqKey.prompt!({ token: "gsk_existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await groqKey.prompt!({ token: "gsk_existing-key" });

        expect(result).toEqual({
          values: { token: "gsk_existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("gsk_new-key" as any);

        const result = await groqKey.prompt!({ token: "gsk_old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "gsk_new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "gsk_test";
        });

        await groqKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns error for input not starting with gsk_", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "gsk_test";
        });

        await groqKey.prompt!(undefined);

        expect(capturedValidate!("invalid-key")).toBe("API key should start with 'gsk_'");
      });

      it("validate returns true for a valid gsk_ key", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "gsk_test";
        });

        await groqKey.prompt!(undefined);

        expect(capturedValidate!("gsk_valid-key")).toBe(true);
      });

      it("validate trims before checking empty", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "gsk_test";
        });

        await groqKey.prompt!(undefined);

        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
