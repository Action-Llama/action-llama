import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import xaiKey from "../../../src/credentials/builtins/xai-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("xai_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(xaiKey.id).toBe("xai_key");
    });

    it("has a single token field", () => {
      expect(xaiKey.fields).toHaveLength(1);
      expect(xaiKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(xaiKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(xaiKey.label).toBe("xAI API Credential");
    });

    it("has a description mentioning Grok", () => {
      expect(xaiKey.description).toContain("Grok");
    });

    it("has a custom prompt function", () => {
      expect(typeof xaiKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("xai-test-key-123" as any);

        const result = await xaiKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "xai-test-key-123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  xai-padded-key  " as any);

        const result = await xaiKey.prompt!(undefined);

        expect(result!.values.token).toBe("xai-padded-key");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await xaiKey.prompt!({ token: "xai-existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await xaiKey.prompt!({ token: "xai-existing-key" });

        expect(result).toEqual({
          values: { token: "xai-existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("xai-new-key" as any);

        const result = await xaiKey.prompt!({ token: "xai-old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "xai-new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "xai-test";
        });

        await xaiKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns error for input not starting with xai-", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "xai-test";
        });

        await xaiKey.prompt!(undefined);

        expect(capturedValidate!("invalid-key")).toBe("API key should start with 'xai-'");
      });

      it("validate returns true for a valid xai- key", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "xai-test";
        });

        await xaiKey.prompt!(undefined);

        expect(capturedValidate!("xai-valid-key")).toBe(true);
      });

      it("validate trims before checking empty", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "xai-test";
        });

        await xaiKey.prompt!(undefined);

        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
