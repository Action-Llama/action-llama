import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
}));

vi.mock("../../../src/setup/validators.js", () => ({
  validateSentryToken: vi.fn().mockResolvedValue({ organizations: [{ slug: "my-org", name: "My Org" }] }),
  validateSentryProjects: vi.fn().mockResolvedValue({ projects: [{ slug: "web", name: "Web App" }, { slug: "api", name: "API" }] }),
}));

import { confirm, password, select, checkbox } from "@inquirer/prompts";
import { validateSentryToken, validateSentryProjects } from "../../../src/setup/validators.js";
import sentryToken from "../../../src/credentials/builtins/sentry-token.js";

const mockedConfirm = vi.mocked(confirm);
const mockedPassword = vi.mocked(password);
const mockedSelect = vi.mocked(select);
const mockedCheckbox = vi.mocked(checkbox);
const mockedValidateSentryToken = vi.mocked(validateSentryToken);
const mockedValidateSentryProjects = vi.mocked(validateSentryProjects);

describe("sentry_token credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidateSentryToken.mockResolvedValue({ organizations: [{ slug: "my-org", name: "My Org" }] } as any);
    mockedValidateSentryProjects.mockResolvedValue({ projects: [{ slug: "web", name: "Web App" }, { slug: "api", name: "API" }] } as any);
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(sentryToken.id).toBe("sentry_token");
    });

    it("has a single token field", () => {
      expect(sentryToken.fields).toHaveLength(1);
      expect(sentryToken.fields[0].name).toBe("token");
    });

    it("token field is marked as secret", () => {
      expect(sentryToken.fields[0].secret).toBe(true);
    });

    it("has a label", () => {
      expect(sentryToken.label).toBe("Sentry Auth Token");
    });

    it("has a description", () => {
      expect(typeof sentryToken.description).toBe("string");
      expect(sentryToken.description.length).toBeGreaterThan(0);
    });

    it("has a helpUrl", () => {
      expect(sentryToken.helpUrl).toBe("https://sentry.io/settings/auth-tokens/");
    });

    it("has envVars mapping token to SENTRY_AUTH_TOKEN", () => {
      expect(sentryToken.envVars).toEqual({ token: "SENTRY_AUTH_TOKEN" });
    });

    it("has a custom prompt function", () => {
      expect(typeof sentryToken.prompt).toBe("function");
    });
  });

  describe("prompt", () => {
    describe("when existing credential is present", () => {
      it("asks to reuse existing credential with default true", async () => {
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedCheckbox.mockResolvedValue(["web"] as any);

        await sentryToken.prompt!({ token: "existing-sentry-token" });

        expect(mockedConfirm).toHaveBeenCalledOnce();
        const confirmCall = mockedConfirm.mock.calls[0][0] as any;
        expect(confirmCall.default).toBe(true);
      });

      it("uses existing token when user chooses to reuse", async () => {
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedCheckbox.mockResolvedValue(["web"] as any);

        const result = await sentryToken.prompt!({ token: "existing-sentry-token" });

        expect(result).toMatchObject({
          values: { token: "existing-sentry-token" },
        });
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for new token when user declines to reuse", async () => {
        mockedConfirm.mockResolvedValueOnce(false as any); // decline reuse
        mockedConfirm.mockResolvedValueOnce(true as any);  // confirm configure sentry
        mockedPassword.mockResolvedValue("new-sentry-token" as any);
        mockedCheckbox.mockResolvedValue(["web"] as any);

        await sentryToken.prompt!({ token: "old-sentry-token" });

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(mockedValidateSentryToken).toHaveBeenCalledWith("new-sentry-token");
      });
    });

    describe("when no existing credential", () => {
      it("asks if user wants to configure Sentry integration", async () => {
        mockedConfirm.mockResolvedValueOnce(false as any);

        const result = await sentryToken.prompt!(undefined);

        expect(mockedConfirm).toHaveBeenCalledOnce();
        expect(result).toBeUndefined();
      });

      it("returns undefined when user declines to configure Sentry", async () => {
        mockedConfirm.mockResolvedValueOnce(false as any);

        const result = await sentryToken.prompt!(undefined);

        expect(result).toBeUndefined();
        expect(mockedPassword).not.toHaveBeenCalled();
      });

      it("prompts for token when user accepts and validates it", async () => {
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedPassword.mockResolvedValue("sntrys_test-token" as any);
        mockedCheckbox.mockResolvedValue(["web"] as any);

        const result = await sentryToken.prompt!(undefined);

        expect(mockedPassword).toHaveBeenCalledOnce();
        expect(mockedValidateSentryToken).toHaveBeenCalledWith("sntrys_test-token");
      });

      it("uses the single org automatically without prompting", async () => {
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedPassword.mockResolvedValue("sntrys_test-token" as any);
        mockedCheckbox.mockResolvedValue(["web"] as any);

        const result = await sentryToken.prompt!(undefined);

        expect(mockedSelect).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          values: { token: "sntrys_test-token" },
          params: { sentryOrg: "my-org" },
        });
      });

      it("prompts for org selection when multiple orgs are returned", async () => {
        mockedValidateSentryToken.mockResolvedValueOnce({
          organizations: [
            { slug: "org-1", name: "Org 1" },
            { slug: "org-2", name: "Org 2" },
          ],
        } as any);
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedPassword.mockResolvedValue("sntrys_test-token" as any);
        mockedSelect.mockResolvedValue("org-2" as any);
        mockedCheckbox.mockResolvedValue(["web"] as any);

        const result = await sentryToken.prompt!(undefined);

        expect(mockedSelect).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
          params: { sentryOrg: "org-2" },
        });
      });

      it("throws when no organizations found", async () => {
        mockedValidateSentryToken.mockResolvedValueOnce({ organizations: [] } as any);
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedPassword.mockResolvedValue("sntrys_test-token" as any);

        await expect(sentryToken.prompt!(undefined)).rejects.toThrow("No organizations found");
      });

      it("returns selected project slugs in params", async () => {
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedPassword.mockResolvedValue("sntrys_test-token" as any);
        mockedCheckbox.mockResolvedValue(["web", "api"] as any);

        const result = await sentryToken.prompt!(undefined);

        expect(result!.params!.sentryProjects).toEqual(["web", "api"]);
      });

      it("returns empty project slugs when user selects none", async () => {
        mockedConfirm.mockResolvedValueOnce(true as any);
        mockedPassword.mockResolvedValue("sntrys_test-token" as any);
        mockedCheckbox.mockResolvedValue([] as any);

        const result = await sentryToken.prompt!(undefined);

        expect(result!.params!.sentryProjects).toEqual([]);
      });
    });
  });

  describe("password prompt validate callback", () => {
    it("validate callback returns true for non-empty token and error message for empty", async () => {
      mockedConfirm.mockResolvedValueOnce(true as any);
      mockedCheckbox.mockResolvedValue(["web"] as any);

      let capturedValidate: ((v: string) => string | true | Promise<string | true>) | undefined;
      mockedPassword.mockImplementation(({ validate }: { validate: (v: string) => string | true | Promise<string | true> }) => {
        capturedValidate = validate;
        return Promise.resolve("sntrys_test-token" as any);
      });

      await sentryToken.prompt!(undefined);

      expect(capturedValidate).toBeDefined();
      // Non-empty token should return true
      expect(capturedValidate!("valid-token")).toBe(true);
      // Empty / whitespace token should return error message
      const emptyResult = capturedValidate!("   ");
      expect(typeof emptyResult).toBe("string");
      expect(emptyResult).not.toBe(true);
    });
  });
});
