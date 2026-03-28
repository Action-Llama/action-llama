import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, password } from "@inquirer/prompts";
import googleKey from "../../../src/credentials/builtins/google-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);

describe("google_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(googleKey.id).toBe("google_key");
    });

    it("has a single token field", () => {
      expect(googleKey.fields).toHaveLength(1);
      expect(googleKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(googleKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(googleKey.label).toBe("Google AI API Credential");
    });

    it("has a description", () => {
      expect(typeof googleKey.description).toBe("string");
      expect(googleKey.description.length).toBeGreaterThan(0);
    });

    it("has a custom prompt function", () => {
      expect(typeof googleKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when no existing credential", () => {
      it("prompts for new API key and returns values", async () => {
        mockedPassword.mockResolvedValue("AIzaSy-test-key-123" as any);

        const result = await googleKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "AIzaSy-test-key-123" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from entered token", async () => {
        mockedPassword.mockResolvedValue("  AIzaSy-padded-key  " as any);

        const result = await googleKey.prompt!(undefined);

        expect(result!.values.token).toBe("AIzaSy-padded-key");
      });
    });

    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await googleKey.prompt!({ token: "AIzaSy-existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing values when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await googleKey.prompt!({ token: "AIzaSy-existing-key" });

        expect(result).toEqual({
          values: { token: "AIzaSy-existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new key when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedPassword.mockResolvedValue("AIzaSy-new-key" as any);

        const result = await googleKey.prompt!({ token: "AIzaSy-old-key" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(result).toEqual({
          values: { token: "AIzaSy-new-key" },
          params: { authType: "api_key" },
        });
      });
    });

    describe("password prompt validation", () => {
      it("validate returns error for empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "AIzaSy-test";
        });

        await googleKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("API key is required");
      });

      it("validate returns true for non-empty input", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "AIzaSy-test";
        });

        await googleKey.prompt!(undefined);

        expect(capturedValidate!("AIzaSy-valid-key")).toBe(true);
      });

      it("validate trims before checking empty", async () => {
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "AIzaSy-test";
        });

        await googleKey.prompt!(undefined);

        expect(capturedValidate!("   ")).toBe("API key is required");
      });
    });
  });
});
