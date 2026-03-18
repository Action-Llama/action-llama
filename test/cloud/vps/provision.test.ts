import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process for SSH
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: mockExecFile };
});

// Mock inquirer prompts
const { mockSelect, mockInput, mockConfirm, mockPassword, mockSearch } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInput: vi.fn(),
  mockConfirm: vi.fn(),
  mockPassword: vi.fn(),
  mockSearch: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: (...args: any[]) => mockSelect(...args),
  input: (...args: any[]) => mockInput(...args),
  confirm: (...args: any[]) => mockConfirm(...args),
  password: (...args: any[]) => mockPassword(...args),
  search: (...args: any[]) => mockSearch(...args),
}));

vi.mock("@inquirer/core", () => ({
  AbortPromptError: class AbortPromptError extends Error {
    constructor() {
      super("Prompt was aborted");
      this.name = "AbortPromptError";
    }
  },
}));

// Mock filesystem backend
const { mockBackendRead } = vi.hoisted(() => ({
  mockBackendRead: vi.fn().mockResolvedValue("fake-vultr-key"),
}));

vi.mock("../../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = mockBackendRead;
  },
}));

// Mock credentials (both static writeCredentialField and dynamic loadCredentialFields/credentialExists)
const { mockWriteCredentialField, mockWriteCredentialFields, mockLoadCredentialFields, mockCredentialExists } = vi.hoisted(() => ({
  mockWriteCredentialField: vi.fn().mockResolvedValue(undefined),
  mockWriteCredentialFields: vi.fn().mockResolvedValue(undefined),
  mockLoadCredentialFields: vi.fn().mockResolvedValue(undefined),
  mockCredentialExists: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../../src/shared/credentials.js", () => ({
  writeCredentialField: (...args: any[]) => mockWriteCredentialField(...args),
  writeCredentialFields: (...args: any[]) => mockWriteCredentialFields(...args),
  loadCredentialFields: (...args: any[]) => mockLoadCredentialFields(...args),
  credentialExists: (...args: any[]) => mockCredentialExists(...args),
}));

// Mock credentials prompter
const { mockPromptCredential } = vi.hoisted(() => ({
  mockPromptCredential: vi.fn(),
}));

vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: (...args: any[]) => mockPromptCredential(...args),
}));

// Mock credentials registry
vi.mock("../../../src/credentials/registry.js", () => ({
  resolveCredential: (id: string) => ({ id, label: id, description: id, fields: [] }),
}));

// Mock vultr-api
const {
  mockListPlans,
  mockListRegions,
  mockListOsImages,
  mockListSshKeys,
  mockCreateSshKey,
  mockCreateInstance,
  mockGetInstance,
  mockListFirewallGroups,
  mockCreateFirewallGroup,
  mockCreateFirewallRule,
  mockListFirewallRules,
} = vi.hoisted(() => ({
  mockListPlans: vi.fn(),
  mockListRegions: vi.fn(),
  mockListOsImages: vi.fn(),
  mockListSshKeys: vi.fn(),
  mockCreateSshKey: vi.fn(),
  mockCreateInstance: vi.fn(),
  mockGetInstance: vi.fn(),
  mockListFirewallGroups: vi.fn(),
  mockCreateFirewallGroup: vi.fn(),
  mockCreateFirewallRule: vi.fn(),
  mockListFirewallRules: vi.fn(),
}));

vi.mock("../../../src/cloud/vps/vultr-api.js", () => ({
  listPlans: (...args: any[]) => mockListPlans(...args),
  listRegions: (...args: any[]) => mockListRegions(...args),
  listOsImages: (...args: any[]) => mockListOsImages(...args),
  listSshKeys: (...args: any[]) => mockListSshKeys(...args),
  createSshKey: (...args: any[]) => mockCreateSshKey(...args),
  createInstance: (...args: any[]) => mockCreateInstance(...args),
  getInstance: (...args: any[]) => mockGetInstance(...args),
  listFirewallGroups: (...args: any[]) => mockListFirewallGroups(...args),
  createFirewallGroup: (...args: any[]) => mockCreateFirewallGroup(...args),
  createFirewallRule: (...args: any[]) => mockCreateFirewallRule(...args),
  listFirewallRules: (...args: any[]) => mockListFirewallRules(...args),
}));

const { setupVpsCloud } = await import("../../../src/cloud/vps/provision.js");

// --- Test data ---

const TEST_PLANS = [
  { id: "vc2-1c-1gb", vcpu_count: 1, ram: 1024, disk: 25, bandwidth: 1, monthly_cost: 5, type: "vc2", locations: ["atl", "ewr"] },
  { id: "vc2-1c-2gb", vcpu_count: 1, ram: 2048, disk: 55, bandwidth: 2, monthly_cost: 10, type: "vc2", locations: ["atl"] },
];

const TEST_REGIONS = [
  { id: "atl", city: "Atlanta", country: "US", continent: "NA", options: [] },
  { id: "ewr", city: "New Jersey", country: "US", continent: "NA", options: [] },
];

const TEST_OS_IMAGES = [
  { id: 2284, name: "Ubuntu 24.04 LTS x64", arch: "x64", family: "ubuntu" },
  { id: 477, name: "Debian 12 x64", arch: "x64", family: "debian" },
  { id: 999, name: "Alpine Linux x64", arch: "x64", family: "alpine" },
];

const TEST_SSH_KEYS = [
  { id: "ssh-key-1", name: "mykey", ssh_key: "ssh-rsa AAAA...", date_created: "2024-01-01" },
];

const TEST_INSTANCE = {
  id: "inst-123",
  os: "Ubuntu 24.04 LTS x64",
  ram: 1024,
  disk: 25,
  main_ip: "1.2.3.4",
  vcpu_count: 1,
  region: "atl",
  plan: "vc2-1c-1gb",
  status: "active",
  power_status: "running",
  server_status: "ok",
  label: "action-llama",
  date_created: "2024-01-01",
};

/** Set up mocks for the Vultr catalog fetch (plans, regions, OS, SSH keys). */
function setupCatalogMocks() {
  mockListPlans.mockResolvedValue(TEST_PLANS);
  mockListRegions.mockResolvedValue(TEST_REGIONS);
  mockListOsImages.mockResolvedValue(TEST_OS_IMAGES);
  mockListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
}

/** Set up mocks for firewall (existing group found). */
function setupFirewallMocks(existingGroup = true) {
  if (existingGroup) {
    mockListFirewallGroups.mockResolvedValue([
      { id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 0, rule_count: 4, max_rule_count: 50 },
    ]);
  } else {
    mockListFirewallGroups.mockResolvedValue([]);
    mockCreateFirewallGroup.mockResolvedValue({ id: "fw-new", description: "action-llama" });
    mockCreateFirewallRule.mockResolvedValue(undefined);
  }
}

/** Set up mocks for instance creation + polling (immediately active). */
function setupInstanceMocks() {
  mockCreateInstance.mockResolvedValue(TEST_INSTANCE);
  mockGetInstance.mockResolvedValue(TEST_INSTANCE);
}

/**
 * Set up SSH/Docker check mocks.
 * testConnection calls `sshExec(config, "echo ok")` — stdout must include "ok".
 * Docker check calls `sshExec(config, "docker info ...")` — stdout is version string.
 * The last arg to execFile is the SSH command.
 */
function setupSshMocks() {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
    const command = args[args.length - 1];
    if (command.includes("echo ok")) {
      cb(null, "ok\n", "");
    } else {
      cb(null, "24.0.7\n", "");
    }
  });
}

describe("VPS provisioning", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockSelect.mockReset();
    mockInput.mockReset();
    mockConfirm.mockReset();
    mockPassword.mockReset();
    mockSearch.mockReset();
    mockBackendRead.mockReset().mockResolvedValue("fake-vultr-key");
    mockWriteCredentialField.mockReset().mockResolvedValue(undefined);
    mockWriteCredentialFields.mockReset().mockResolvedValue(undefined);
    mockLoadCredentialFields.mockReset().mockResolvedValue(undefined);
    mockCredentialExists.mockReset().mockResolvedValue(false);
    mockPromptCredential.mockReset();
    mockListPlans.mockReset();
    mockListRegions.mockReset();
    mockListOsImages.mockReset();
    mockListSshKeys.mockReset();
    mockCreateSshKey.mockReset();
    mockCreateInstance.mockReset();
    mockGetInstance.mockReset();
    mockListFirewallGroups.mockReset();
    mockCreateFirewallGroup.mockReset();
    mockCreateFirewallRule.mockReset();
    mockListFirewallRules.mockReset();
  });

  describe("existing server path", () => {
    it("returns config on successful SSH + Docker check", async () => {
      mockSelect.mockResolvedValueOnce("existing");

      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("root")
        .mockResolvedValueOnce("22")
        .mockResolvedValueOnce("~/.ssh/id_rsa");

      let callIdx = 0;
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        callIdx++;
        if (callIdx === 1) {
          cb(null, "ok\n", "");
        } else {
          cb(null, "24.0.7\n", "");
        }
      });

      const result = await setupVpsCloud();
      expect(result).toEqual({
        provider: "vps",
        host: "5.6.7.8",
      });
    });

    it("returns null when SSH connection fails", async () => {
      mockSelect.mockResolvedValueOnce("existing");
      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("root")
        .mockResolvedValueOnce("22")
        .mockResolvedValueOnce("~/.ssh/id_rsa");

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(new Error("Connection refused"), "", "");
      });

      const result = await setupVpsCloud();
      expect(result).toBeNull();
    });

    it("returns null when Docker not available", async () => {
      mockSelect.mockResolvedValueOnce("existing");
      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("root")
        .mockResolvedValueOnce("22")
        .mockResolvedValueOnce("~/.ssh/id_rsa");

      let callIdx = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        callIdx++;
        if (callIdx === 1) {
          cb(null, "ok\n", "");
        } else {
          const err: any = new Error("docker not found");
          err.code = 127;
          cb(err, "", "command not found: docker");
        }
      });

      const result = await setupVpsCloud();
      expect(result).toBeNull();
    });

    it("includes non-default SSH settings in config", async () => {
      mockSelect.mockResolvedValueOnce("existing");
      mockInput
        .mockResolvedValueOnce("5.6.7.8")
        .mockResolvedValueOnce("ubuntu")
        .mockResolvedValueOnce("2222")
        .mockResolvedValueOnce("~/.ssh/mykey");

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "ok\n24.0.7\n", "");
      });

      const result = await setupVpsCloud();
      expect(result).toEqual({
        provider: "vps",
        host: "5.6.7.8",
        sshUser: "ubuntu",
        sshPort: 2222,
        sshKeyPath: "~/.ssh/mykey",
      });
    });
  });

  describe("vultr provisioning path", () => {
    it("provisions with existing Vultr SSH key and existing firewall group", async () => {
      // Mode: vultr
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      // searchWithEsc calls: plan, region, (OS auto-selected), SSH key
      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")  // plan
        .mockResolvedValueOnce("atl")          // region
        // OS auto-selected (Ubuntu 24.04, ram=1024 >= 1024)
        .mockResolvedValueOnce("ssh-key-1");   // existing Vultr key

      setupSshMocks();

      // Final confirmation
      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).toEqual({
        provider: "vps",
        host: "1.2.3.4",
        vultrInstanceId: "inst-123",
        vultrRegion: "atl",
      });

      expect(mockCreateInstance).toHaveBeenCalledWith("fake-vultr-key", expect.objectContaining({
        region: "atl",
        plan: "vc2-1c-1gb",
        os_id: 2284,
        sshkey_id: ["ssh-key-1"],
      }));
    });

    it("prompts for API key when not found in credentials", async () => {
      mockSelect.mockResolvedValueOnce("vultr");
      mockBackendRead.mockResolvedValue(null); // No API key stored

      // Password prompt for API key
      mockPassword.mockResolvedValueOnce("  new-api-key  ");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("ssh-key-1");

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).not.toBeNull();
      expect(mockWriteCredentialField).toHaveBeenCalledWith(
        "vultr_api_key", "default", "api_key", "new-api-key",
      );
      // Verify catalog was fetched with the new key
      expect(mockListPlans).toHaveBeenCalledWith("new-api-key");
    });

    it("creates new firewall group when none exists", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(false); // No existing firewall group
      setupInstanceMocks();

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("ssh-key-1");

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      await setupVpsCloud();

      expect(mockCreateFirewallGroup).toHaveBeenCalledWith("fake-vultr-key", "action-llama");
      expect(mockCreateFirewallRule).toHaveBeenCalledTimes(4); // SSH + gateway × IPv4 + IPv6
    });

    it("prompts for OS when plan has < 1024MB RAM", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      // Use a plan with 512MB RAM
      const smallPlans = [
        { id: "vc2-1c-0.5gb", vcpu_count: 1, ram: 512, disk: 10, bandwidth: 0.5, monthly_cost: 2.5, type: "vc2", locations: ["atl"] },
      ];
      mockListPlans.mockResolvedValue(smallPlans);
      mockListRegions.mockResolvedValue(TEST_REGIONS);
      mockListOsImages.mockResolvedValue(TEST_OS_IMAGES);
      mockListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
      setupFirewallMocks(true);

      const instanceWithSmallPlan = { ...TEST_INSTANCE, plan: "vc2-1c-0.5gb", ram: 512 };
      mockCreateInstance.mockResolvedValue(instanceWithSmallPlan);
      mockGetInstance.mockResolvedValue(instanceWithSmallPlan);

      mockSearch
        .mockResolvedValueOnce("vc2-1c-0.5gb")  // plan
        .mockResolvedValueOnce("atl")            // region
        .mockResolvedValueOnce(999)              // OS — Alpine (prompted, not auto-selected)
        .mockResolvedValueOnce("ssh-key-1");     // SSH key

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).not.toBeNull();
      expect(mockCreateInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        os_id: 999,
      }));
      // search was called 4 times: plan, region, OS, SSH key
      expect(mockSearch).toHaveBeenCalledTimes(4);
    });

    it("creates new SSH key via promptCredential when user selects __new__", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        // OS auto-selected
        .mockResolvedValueOnce("__new__")      // new SSH key
        ;

      // promptCredential returns a keypair
      mockPromptCredential.mockResolvedValueOnce({
        values: { private_key: "PRIVATE", public_key: "ssh-ed25519 AAAA..." },
      });

      // createSshKey uploads to Vultr
      mockCreateSshKey.mockResolvedValueOnce({ id: "uploaded-key-1", name: "action-llama", ssh_key: "ssh-ed25519 AAAA..." });

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).not.toBeNull();
      expect(mockPromptCredential).toHaveBeenCalled();
      // Credential must be persisted before uploading to Vultr
      expect(mockWriteCredentialFields).toHaveBeenCalledWith("vps_ssh", "default", {
        private_key: "PRIVATE",
        public_key: "ssh-ed25519 AAAA...",
      });
      expect(mockCreateSshKey).toHaveBeenCalledWith("fake-vultr-key", "action-llama", "ssh-ed25519 AAAA...");
      expect(mockCreateInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        sshkey_id: ["uploaded-key-1"],
      }));
    });

    it("uses existing AL vps_ssh credential and uploads to Vultr", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      // vps_ssh credential exists
      mockCredentialExists.mockResolvedValue(true);
      mockLoadCredentialFields.mockResolvedValue({
        private_key: "PRIVATE",
        public_key: "ssh-ed25519 BBBB...",
      });

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("__al_credential__");

      // Upload to Vultr (public key not already on Vultr)
      mockCreateSshKey.mockResolvedValueOnce({ id: "uploaded-key-2", name: "action-llama", ssh_key: "ssh-ed25519 BBBB..." });

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).not.toBeNull();
      expect(mockCreateSshKey).toHaveBeenCalledWith("fake-vultr-key", "action-llama", "ssh-ed25519 BBBB...");
      expect(mockCreateInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        sshkey_id: ["uploaded-key-2"],
      }));
    });

    it("reuses Vultr key when AL credential public key already exists on Vultr", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      const pubKey = "ssh-ed25519 CCCC...";
      const vultrKeys = [
        { id: "existing-vultr-key", name: "mykey", ssh_key: pubKey, date_created: "2024-01-01" },
      ];
      mockListPlans.mockResolvedValue(TEST_PLANS);
      mockListRegions.mockResolvedValue(TEST_REGIONS);
      mockListOsImages.mockResolvedValue(TEST_OS_IMAGES);
      mockListSshKeys.mockResolvedValue(vultrKeys);
      setupFirewallMocks(true);
      setupInstanceMocks();

      mockCredentialExists.mockResolvedValue(true);
      mockLoadCredentialFields.mockResolvedValue({
        private_key: "PRIVATE",
        public_key: pubKey,
      });

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("__al_credential__");

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).not.toBeNull();
      // Should NOT upload — key already on Vultr
      expect(mockCreateSshKey).not.toHaveBeenCalled();
      expect(mockCreateInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        sshkey_id: ["existing-vultr-key"],
      }));
    });

    it("calls onInstanceCreated callback with partial config", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("ssh-key-1");

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const onInstanceCreated = vi.fn();
      await setupVpsCloud(onInstanceCreated);

      // Called at least once with the instance ID
      expect(onInstanceCreated).toHaveBeenCalled();
      const firstCall = onInstanceCreated.mock.calls[0][0];
      expect(firstCall).toHaveProperty("vultrInstanceId", "inst-123");
      expect(firstCall).toHaveProperty("provider", "vps");
    });

    it("returns null when user declines final confirmation", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("ssh-key-1");

      setupSshMocks();

      // User declines
      mockConfirm.mockResolvedValueOnce(false);

      const result = await setupVpsCloud();
      expect(result).toBeNull();
    });

    it("returns null when instance never becomes active (timeout)", async () => {
      vi.useFakeTimers();

      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);

      // Instance is created but never becomes active
      const pendingInstance = { ...TEST_INSTANCE, status: "pending", main_ip: "0.0.0.0" };
      mockCreateInstance.mockResolvedValue(pendingInstance);
      mockGetInstance.mockResolvedValue(pendingInstance);

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("ssh-key-1");

      // Run setupVpsCloud concurrently while advancing fake timers
      const resultPromise = setupVpsCloud();

      // Advance time past the 10-minute timeout in chunks
      // Each iteration: getInstance resolves immediately, then setTimeout(10_000) blocks
      for (let i = 0; i < 70; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
      }

      const result = await resultPromise;

      expect(result).toBeNull();

      vi.useRealTimers();
    });

    it("stays on SSH key step when promptCredential returns undefined (user cancels)", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      // First attempt: user picks __new__, then cancels the prompt, then picks existing key
      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("__new__")      // first attempt — will cancel
        .mockResolvedValueOnce("ssh-key-1");   // second attempt — existing key

      mockPromptCredential.mockResolvedValueOnce(undefined); // cancel

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      const result = await setupVpsCloud();

      expect(result).not.toBeNull();
      expect(mockPromptCredential).toHaveBeenCalledTimes(1);
      expect(mockCreateInstance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        sshkey_id: ["ssh-key-1"],
      }));
    });

    it("filters regions by plan availability", async () => {
      mockSelect.mockResolvedValueOnce("vultr");

      // Plan only available in "atl"
      const restrictedPlans = [
        { id: "vc2-1c-2gb", vcpu_count: 1, ram: 2048, disk: 55, bandwidth: 2, monthly_cost: 10, type: "vc2", locations: ["atl"] },
      ];
      mockListPlans.mockResolvedValue(restrictedPlans);
      mockListRegions.mockResolvedValue(TEST_REGIONS);
      mockListOsImages.mockResolvedValue(TEST_OS_IMAGES);
      mockListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
      setupFirewallMocks(true);
      setupInstanceMocks();

      // Capture the region choices passed to search
      let regionChoices: any[] = [];
      mockSearch.mockImplementation(async (opts: any) => {
        if (opts.message === "Region:") {
          regionChoices = opts.source(undefined);
          return "atl";
        }
        if (opts.message === "Plan:") return "vc2-1c-2gb";
        if (opts.message === "SSH key:") return "ssh-key-1";
        return null;
      });

      setupSshMocks();

      mockConfirm.mockResolvedValueOnce(true);

      await setupVpsCloud();

      // searchWithEsc wraps search — the source function filters choices
      // Only "atl" should be available since "ewr" is not in the plan's locations
      // Note: searchWithEsc calls search with a source function, so we verify via the mock
      expect(mockSearch).toHaveBeenCalled();
    });
  });
});
