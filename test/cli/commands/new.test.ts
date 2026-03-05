import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureLog } from "../../helpers.js";

const mockPromptCredential = vi.fn();
vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: (...args: any[]) => mockPromptCredential(...args),
}));

vi.mock("../../../src/credentials/registry.js", () => ({
  resolveCredential: () => ({
    id: "anthropic_key",
    label: "Anthropic API Credential",
    fields: [{ name: "token", label: "API Key", secret: true }],
  }),
}));

const mockWriteCredentialFields = vi.fn();
const mockLoadCredentialField = vi.fn();
vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredentialField: (...args: any[]) => mockLoadCredentialField(...args),
  writeCredentialFields: (...args: any[]) => mockWriteCredentialFields(...args),
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  requireCredentialRef: () => {},
  credentialExists: () => true,
  writeCredentialField: () => {},
}));

vi.mock("../../../src/setup/scaffold.js", () => ({
  scaffoldProject: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execute } from "../../../src/cli/commands/new.js";

describe("new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCredentialField.mockReturnValue(undefined);
  });

  it("throws when no project name given", async () => {
    await expect(execute("")).rejects.toThrow();
  });

  it("writes new anthropic credential", async () => {
    mockPromptCredential.mockResolvedValue({
      values: { token: "sk-ant-api-new" },
      params: { authType: "api_key" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("anthropic_key", "default", { token: "sk-ant-api-new" });
    expect(output).toContain("Setup complete!");
  });

  it("skips unchanged anthropic credential", async () => {
    mockLoadCredentialField.mockReturnValue("sk-ant-api-existing");
    mockPromptCredential.mockResolvedValue({
      values: { token: "sk-ant-api-existing" },
      params: { authType: "api_key" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).not.toHaveBeenCalled();
    expect(output).toContain("Anthropic key unchanged");
  });

  it("handles pi_auth (no anthropic key file)", async () => {
    mockPromptCredential.mockResolvedValue({
      values: {},
      params: { authType: "pi_auth" },
    });

    const output = await captureLog(() => execute("my-project"));
    expect(mockWriteCredentialFields).not.toHaveBeenCalled();
    expect(output).toContain("Using existing pi auth");
  });
});
