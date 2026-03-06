import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTmpProject } from "../../helpers.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock pi-coding-agent to avoid launching real console
const mockRun = vi.fn().mockResolvedValue(undefined);
let capturedOptions: any;
vi.mock("@mariozechner/pi-coding-agent", () => {
  class MockResourceLoader { async reload() {} }
  class MockInteractiveMode {
    constructor(_session: any, options: any) { capturedOptions = options; }
    async run() { return mockRun(); }
  }
  return {
    AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
    createAgentSession: vi.fn().mockResolvedValue({ session: { dispose: vi.fn() } }),
    DefaultResourceLoader: MockResourceLoader,
    SessionManager: { inMemory: vi.fn() },
    SettingsManager: { inMemory: vi.fn() },
    createCodingTools: vi.fn().mockReturnValue([]),
    InteractiveMode: MockInteractiveMode,
  };
});

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ id: "claude-sonnet-4-20250514", provider: "anthropic" }),
}));

vi.mock("../../../src/shared/credentials.js", () => ({
  loadCredentialField: vi.fn().mockReturnValue("sk-ant-api-test"),
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  requireCredentialRef: () => {},
  writeCredentialField: () => {},
  writeCredentialFields: () => {},
  credentialExists: () => true,
  backendLoadField: () => Promise.resolve("sk-ant-api-test"),
  backendLoadFields: () => Promise.resolve({}),
  backendCredentialExists: () => Promise.resolve(true),
  backendListInstances: () => Promise.resolve([]),
  backendRequireCredentialRef: () => Promise.resolve(),
  getDefaultBackend: () => {},
  setDefaultBackend: () => {},
  resetDefaultBackend: () => {},
}));

import { execute } from "../../../src/cli/commands/console.js";

describe("console", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = undefined;
  });

  it("launches console with agent summary when agents exist", async () => {
    const dir = makeTmpProject();
    await execute({ project: dir });

    expect(mockRun).toHaveBeenCalled();
    expect(capturedOptions.initialMessage).toContain("agent");
    expect(capturedOptions.initialMessage).toContain("What would you like to do");
  });

  it("launches console with short initial message when no agents exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "al-empty-"));
    await execute({ project: dir });

    expect(mockRun).toHaveBeenCalled();
    // Initial message should be short — template details are in system context, not the user prompt
    expect(capturedOptions.initialMessage).toContain("first agent");
  });
});
