import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../../src/setup/validators.js", () => ({
  validateAnthropicApiKey: vi.fn().mockResolvedValue(undefined),
  validateOAuthTokenFormat: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => {
  const mockGetAvailable = vi.fn().mockResolvedValue([{ provider: "anthropic" }]);
  function MockModelRegistry(_authStorage: any) {
    return { getAvailable: mockGetAvailable };
  }
  MockModelRegistry.__mockGetAvailable = mockGetAvailable;
  return {
    AuthStorage: {
      create: vi.fn().mockReturnValue({}),
    },
    ModelRegistry: MockModelRegistry,
  };
});

import { confirm, password, select } from "@inquirer/prompts";
import { validateAnthropicApiKey, validateOAuthTokenFormat } from "../../../src/setup/validators.js";
import * as piCodingAgent from "@mariozechner/pi-coding-agent";
import anthropicKey from "../../../src/credentials/builtins/anthropic-key.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);
const mockedSelect = vi.mocked(select);
const mockedValidateApiKey = vi.mocked(validateAnthropicApiKey);
const mockedValidateOAuthFormat = vi.mocked(validateOAuthTokenFormat);

describe("anthropic_key credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidateApiKey.mockResolvedValue(undefined as any);
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(anthropicKey.id).toBe("anthropic_key");
    });

    it("has a single token field", () => {
      expect(anthropicKey.fields).toHaveLength(1);
      expect(anthropicKey.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(anthropicKey.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(anthropicKey.label).toBe("Anthropic API Credential");
    });

    it("has a description", () => {
      expect(typeof anthropicKey.description).toBe("string");
      expect(anthropicKey.description.length).toBeGreaterThan(0);
    });

    it("has a custom prompt function", () => {
      expect(typeof anthropicKey.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        await anthropicKey.prompt!({ token: "sk-ant-api-existing-key" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("returns existing API key with api_key authType when token starts with sk-ant-api", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await anthropicKey.prompt!({ token: "sk-ant-api-existing-key" });

        expect(result).toEqual({
          values: { token: "sk-ant-api-existing-key" },
          params: { authType: "api_key" },
        });
        expect(mockedSelect).not.toHaveBeenCalled();
      });

      it("returns existing OAuth token with oauth_token authType when token contains sk-ant-oat", async () => {
        mockedConfirm.mockResolvedValue(true as any);

        const result = await anthropicKey.prompt!({ token: "sk-ant-oat-existing-token" });

        expect(result).toEqual({
          values: { token: "sk-ant-oat-existing-token" },
          params: { authType: "oauth_token" },
        });
      });

      it("proceeds to auth method selection when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValue(false as any);
        mockedSelect.mockResolvedValue("api_key" as any);
        mockedPassword.mockResolvedValue("sk-ant-api-new-key" as any);

        await anthropicKey.prompt!({ token: "sk-ant-api-old-key" });

        expect(mockedSelect).toHaveBeenCalledOnce();
      });
    });

    describe("when no existing credential — api_key flow", () => {
      it("prompts for auth method selection", async () => {
        mockedSelect.mockResolvedValue("api_key" as any);
        mockedPassword.mockResolvedValue("sk-ant-api-test-key" as any);

        await anthropicKey.prompt!(undefined);

        expect(mockedSelect).toHaveBeenCalledOnce();
      });

      it("prompts for API key and validates it", async () => {
        mockedSelect.mockResolvedValue("api_key" as any);
        mockedPassword.mockResolvedValue("sk-ant-api-test-key" as any);

        const result = await anthropicKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(mockedValidateApiKey).toHaveBeenCalledWith("sk-ant-api-test-key");
        expect(result).toEqual({
          values: { token: "sk-ant-api-test-key" },
          params: { authType: "api_key" },
        });
      });

      it("trims whitespace from API key", async () => {
        mockedSelect.mockResolvedValue("api_key" as any);
        mockedPassword.mockResolvedValue("  sk-ant-api-padded  " as any);

        const result = await anthropicKey.prompt!(undefined);

        expect(result!.values.token).toBe("sk-ant-api-padded");
      });

      it("API key validate callback returns error for empty input", async () => {
        mockedSelect.mockResolvedValue("api_key" as any);
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-ant-api-test";
        });

        await anthropicKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("Key is required");
      });

      it("API key validate callback returns true for non-empty input", async () => {
        mockedSelect.mockResolvedValue("api_key" as any);
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-ant-api-test";
        });

        await anthropicKey.prompt!(undefined);

        expect(capturedValidate!("sk-ant-api-test-key")).toBe(true);
      });
    });

    describe("when no existing credential — oauth_token flow", () => {
      it("prompts for OAuth token and validates its format", async () => {
        mockedSelect.mockResolvedValue("oauth_token" as any);
        mockedPassword.mockResolvedValue("sk-ant-oat-test-token" as any);

        const result = await anthropicKey.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(mockedValidateOAuthFormat).toHaveBeenCalledWith("sk-ant-oat-test-token");
        expect(result).toEqual({
          values: { token: "sk-ant-oat-test-token" },
          params: { authType: "oauth_token" },
        });
      });

      it("trims whitespace from OAuth token", async () => {
        mockedSelect.mockResolvedValue("oauth_token" as any);
        mockedPassword.mockResolvedValue("  sk-ant-oat-padded  " as any);

        const result = await anthropicKey.prompt!(undefined);

        expect(result!.values.token).toBe("sk-ant-oat-padded");
      });

      it("OAuth token validate callback returns error for empty input", async () => {
        mockedSelect.mockResolvedValue("oauth_token" as any);
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-ant-oat-test";
        });

        await anthropicKey.prompt!(undefined);

        expect(capturedValidate!("")).toBe("Token is required");
      });

      it("OAuth token validate callback returns true for non-empty input", async () => {
        mockedSelect.mockResolvedValue("oauth_token" as any);
        let capturedValidate: ((v: string) => string | true) | undefined;
        mockedPassword.mockImplementation(async (opts: any) => {
          capturedValidate = opts.validate;
          return "sk-ant-oat-test";
        });

        await anthropicKey.prompt!(undefined);

        expect(capturedValidate!("sk-ant-oat-token")).toBe(true);
      });
    });

    describe("when no existing credential — pi_auth flow", () => {
      it("returns pi_auth values with empty token values when Anthropic auth found", async () => {
        // The module-level mock already returns [{ provider: "anthropic" }]
        mockedSelect.mockResolvedValue("pi_auth" as any);

        const result = await anthropicKey.prompt!(undefined);

        expect(result).toEqual({
          values: {},
          params: { authType: "pi_auth" },
        });
      });

      it("throws an error when no Anthropic auth found in pi auth storage", async () => {
        // Temporarily override getAvailable to return no Anthropic providers
        const mockRegistry = (piCodingAgent as any).ModelRegistry;
        const origImpl = mockRegistry;
        function NoAnthropicRegistry(_authStorage: any) {
          return { getAvailable: vi.fn().mockResolvedValue([{ provider: "openai" }]) };
        }
        // Replace the factory temporarily
        Object.defineProperty(piCodingAgent, "ModelRegistry", { value: NoAnthropicRegistry, configurable: true, writable: true });

        mockedSelect.mockResolvedValue("pi_auth" as any);

        try {
          await expect(anthropicKey.prompt!(undefined)).rejects.toThrow(
            "No Anthropic credentials found in pi auth storage"
          );
        } finally {
          Object.defineProperty(piCodingAgent, "ModelRegistry", { value: origImpl, configurable: true, writable: true });
        }
      });
    });
  });
});
