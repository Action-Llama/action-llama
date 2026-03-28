import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import openaiKey from "../../../src/credentials/builtins/openai-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("openai_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(openaiKey.id).toBe("openai_key");
    });

    it("has a single token field", () => {
      expect(openaiKey.fields).toHaveLength(1);
      expect(openaiKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(openaiKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(openaiKey.label).toBe("OpenAI API Credential");
    });

    it("has a description", () => {
      expect(typeof openaiKey.description).toBe("string");
      expect(openaiKey.description.length).toBeGreaterThan(0);
    });

    it("has a custom prompt function", () => {
      expect(typeof openaiKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("sk-test-key-123" as any);

        const result = await openaiKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "sk-test-key-123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  sk-padded-key  " as any);

        const result = await openaiKey.prompt!(undefined);

        expect(result!.values.token).toBe("sk-padded-key");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await openaiKey.prompt!({ token: "sk-existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await openaiKey.prompt!({ token: "sk-existing-key" });

        expect(result).toEqual({
          values: { token: "sk-existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("sk-new-key" as any);

        const result = await openaiKey.prompt!({ token: "sk-old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "sk-new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error message for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-test";
        });

        await openaiKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns error message for input not starting with sk-", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-test";
        });

        await openaiKey.prompt!(undefined);

        expect(capturedValidate!("invalid-key")).toBe("API key should start with 'sk-'");
      });

      it("validate returns true for a valid sk- key", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-test";
        });

        await openaiKey.prompt!(undefined);

        expect(capturedValidate!("sk-valid-key")).toBe(true);
      });

      it("validate trims input before checking", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-test";
        });

        await openaiKey.prompt!(undefined);

        // "  " trims to "" which should fail
        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
