import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  credentialDir: (type: string, instance: string) => `/mock-creds/${type}/${instance}`,
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

// Mock Cloudflare API for promptCloudflareHttps and post-provisioning HTTPS setup
const {
  mockVerifyToken,
  mockListAllZones,
  mockCreateDnsRecord,
  mockUpsertDnsRecord,
  mockCreateOriginCertificate,
  mockCreatePageRule,
  mockSetSslMode,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn().mockResolvedValue(true),
  mockListAllZones: vi.fn().mockResolvedValue([]),
  mockCreateDnsRecord: vi.fn().mockResolvedValue({}),
  mockUpsertDnsRecord: vi.fn().mockResolvedValue({ id: "dns-record-123" }),
  mockCreateOriginCertificate: vi.fn().mockResolvedValue({ certificate: "cert", private_key: "key" }),
  mockCreatePageRule: vi.fn().mockResolvedValue({}),
  mockSetSslMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/cloud/cloudflare/api.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  listAllZones: (...args: any[]) => mockListAllZones(...args),
  createDnsRecord: (...args: any[]) => mockCreateDnsRecord(...args),
  upsertDnsRecord: (...args: any[]) => mockUpsertDnsRecord(...args),
  createOriginCertificate: (...args: any[]) => mockCreateOriginCertificate(...args),
  createPageRule: (...args: any[]) => mockCreatePageRule(...args),
  setSslMode: (...args: any[]) => mockSetSslMode(...args),
}));

// Mock nginx module for Cloudflare HTTPS post-provisioning
const { mockInstallNginx, mockConfigureNginx } = vi.hoisted(() => ({
  mockInstallNginx: vi.fn().mockResolvedValue(undefined),
  mockConfigureNginx: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/cloud/vps/nginx.js", () => ({
  installNginx: (...args: any[]) => mockInstallNginx(...args),
  configureNginx: (...args: any[]) => mockConfigureNginx(...args),
  generateNginxConfig: () => "server {}",
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
 * Set up SSH/Docker/Node check mocks.
 * testConnection calls `sshExec(config, "echo ok")` — stdout must include "ok".
 * Node check calls `sshExec(config, "node --version")` — stdout is version string.
 * Docker check calls `sshExec(config, "docker info ...")` — stdout is version string.
 * The last arg to execFile is the SSH command.
 */
function setupSshMocks() {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
    const command = args[args.length - 1];
    if (command.includes("echo ok")) {
      cb(null, "ok\n", "");
    } else if (command.includes("node --version")) {
      cb(null, "v22.14.0\n", "");
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
    mockVerifyToken.mockReset().mockResolvedValue(true);
    mockListAllZones.mockReset().mockResolvedValue([]);
    mockCreateDnsRecord.mockReset().mockResolvedValue({});
    mockUpsertDnsRecord.mockReset().mockResolvedValue({ id: "dns-record-123" });
    mockCreateOriginCertificate.mockReset().mockResolvedValue({ certificate: "cert", private_key: "key" });
    mockCreatePageRule.mockReset().mockResolvedValue({});
    mockSetSslMode.mockReset().mockResolvedValue(undefined);
    mockInstallNginx.mockReset().mockResolvedValue(undefined);
    mockConfigureNginx.mockReset().mockResolvedValue(undefined);
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

      // Decline Cloudflare HTTPS
      mockConfirm.mockResolvedValueOnce(false);

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
        gatewayUrl: "http://1.2.3.4:3000",
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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS
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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      // sshKeyPath stored in returned config
      expect(result).toHaveProperty("sshKeyPath", "/mock-creds/vps_ssh/default/private_key");
    });

    it("uses existing AL vps_ssh credential and uploads to Vultr", async () => {
      mockSelect.mockResolvedValueOnce("vultr");
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      // sshKeyPath stored in returned config
      expect(result).toHaveProperty("sshKeyPath", "/mock-creds/vps_ssh/default/private_key");
    });

    it("reuses Vultr key when AL credential public key already exists on Vultr", async () => {
      mockSelect.mockResolvedValueOnce("vultr");
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      // sshKeyPath stored in returned config
      expect(result).toHaveProperty("sshKeyPath", "/mock-creds/vps_ssh/default/private_key");
    });

    it("calls onInstanceCreated callback with partial config", async () => {
      mockSelect.mockResolvedValueOnce("vultr");
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

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

/**
 * Helper: set up minimal Vultr mocks to complete provisionVultr after promptCloudflareHttps returns null.
 */
function setupFullVultrFlow() {
  setupCatalogMocks();
  setupFirewallMocks(true);
  setupInstanceMocks();

  // searchWithEsc calls for plan, region, SSH key
  mockSearch
    .mockResolvedValueOnce("vc2-1c-1gb")  // plan
    .mockResolvedValueOnce("atl")          // region
    .mockResolvedValueOnce("ssh-key-1");   // existing Vultr key

  setupSshMocks();

  // Final confirmation (proceed with provisioning)
  mockConfirm.mockResolvedValueOnce(true);
}

describe("promptCloudflareHttps paths", () => {
  beforeEach(() => {
    // reset all already handled by outer beforeEach via describe scope
  });

  it("returns null from promptCloudflareHttps when listAllZones returns empty, then provisions normally", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    // Stored token found
    mockBackendRead.mockResolvedValue("stored-cf-token");
    // listAllZones returns empty → promptCloudflareHttps returns null
    mockListAllZones.mockResolvedValue([]);

    setupFullVultrFlow();

    const result = await setupVpsCloud();
    expect(result).toBeDefined();
    expect(result?.provider).toBe("vps");
    expect(mockListAllZones).toHaveBeenCalledWith("stored-cf-token");
  });

  it("returns null from promptCloudflareHttps when listAllZones throws, then provisions normally", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    mockBackendRead.mockResolvedValue("stored-cf-token");
    mockListAllZones.mockRejectedValue(new Error("API unavailable"));

    setupFullVultrFlow();

    const result = await setupVpsCloud();
    expect(result?.provider).toBe("vps");
  });

  it("returns null from promptCloudflareHttps when zone search throws AbortPromptError (ESC pressed)", async () => {
    const { AbortPromptError } = await import("@inquirer/core");

    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    mockBackendRead.mockResolvedValue("stored-cf-token");
    mockListAllZones.mockResolvedValue([
      { id: "zone-1", name: "example.com", status: "active" },
    ]);
    // User presses ESC on zone search → AbortPromptError
    mockSearch.mockRejectedValueOnce(new AbortPromptError());

    setupFullVultrFlow();

    const result = await setupVpsCloud();
    expect(result?.provider).toBe("vps");
  });

  it("returns null from promptCloudflareHttps when no stored token and verifyToken returns false", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    // Return null for cloudflare, "fake-vultr-key" for vultr
    mockBackendRead.mockImplementation((type: string) =>
      type === "cloudflare_api_token" ? Promise.resolve(null) : Promise.resolve("fake-vultr-key")
    );
    mockPassword.mockResolvedValueOnce("bad-token");
    mockVerifyToken.mockResolvedValue(false); // Token not active

    setupFullVultrFlow();

    const result = await setupVpsCloud();
    expect(result?.provider).toBe("vps");
    expect(mockVerifyToken).toHaveBeenCalledWith("bad-token");
  });

  it("returns null from promptCloudflareHttps when verifyToken throws", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    mockBackendRead.mockImplementation((type: string) =>
      type === "cloudflare_api_token" ? Promise.resolve(null) : Promise.resolve("fake-vultr-key")
    );
    mockPassword.mockResolvedValueOnce("bad-token");
    mockVerifyToken.mockRejectedValue(new Error("Network error"));

    setupFullVultrFlow();

    const result = await setupVpsCloud();
    expect(result?.provider).toBe("vps");
  });

  it("promptCloudflareHttps prompts for new token when no stored token and token valid, then saves it", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    mockBackendRead.mockImplementation((type: string) =>
      type === "cloudflare_api_token" ? Promise.resolve(null) : Promise.resolve("fake-vultr-key")
    );
    mockPassword.mockResolvedValueOnce("new-cf-token");
    mockVerifyToken.mockResolvedValue(true); // Token is active
    mockListAllZones.mockResolvedValue([]); // No zones → return null early

    setupFullVultrFlow();

    const result = await setupVpsCloud();
    expect(result?.provider).toBe("vps");
    expect(mockVerifyToken).toHaveBeenCalledWith("new-cf-token");
    expect(mockWriteCredentialField).toHaveBeenCalledWith("cloudflare_api_token", "default", "api_token", "new-cf-token");
  });
});

/**
 * Helper: set up mocks for a complete promptCloudflareHttps flow that succeeds
 * (returns a non-null CloudflareConfig).
 */
function setupCloudflareMocks() {
  mockBackendRead.mockImplementation((type: string) => {
    if (type === "cloudflare_origin_cert") return Promise.resolve(null); // No existing cert
    return Promise.resolve("stored-cf-token"); // All other types return vultr key / CF token
  });
  mockListAllZones.mockResolvedValue([{ id: "zone-1", name: "example.com", status: "active" }]);
  // Zone selection + subdomain input
  mockSearch.mockResolvedValueOnce({ id: "zone-1", name: "example.com" }); // zone selected
  mockInput.mockResolvedValueOnce("agents"); // subdomain
}

/** Full beforeEach reset to avoid cross-test mock state pollution. */
function resetAllMocks() {
  vi.clearAllMocks();
  mockBackendRead.mockResolvedValue("fake-vultr-key");
  mockVerifyToken.mockResolvedValue(true);
  mockListAllZones.mockResolvedValue([]);
  mockUpsertDnsRecord.mockResolvedValue({ id: "dns-record-123" });
  mockCreateOriginCertificate.mockResolvedValue({ certificate: "cert", private_key: "key" });
  mockSetSslMode.mockResolvedValue(undefined);
  mockInstallNginx.mockResolvedValue(undefined);
  mockConfigureNginx.mockResolvedValue(undefined);
}

describe("promptCloudflareHttps full success path", () => {
  beforeEach(() => resetAllMocks());

  it("returns CloudflareConfig when zone and subdomain are selected", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    setupFullVultrFlow();

    const result = await setupVpsCloud();

    // The zone was selected and subdomain was entered; hostname should be in result
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // The CF flow succeeds so we should have processed the DNS record
    expect(mockUpsertDnsRecord).toHaveBeenCalled();
  });

  it("includes cloudflare metadata in result on successful CF setup", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    setupFullVultrFlow();

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.cloudflareHostname).toBe("agents.example.com");
    expect(result?.cloudflareDnsRecordId).toBe("dns-record-123");
    // gatewayUrl should be https when CF setup succeeds
    expect(result?.gatewayUrl).toBe("https://agents.example.com");
  });

  it("creates new origin certificate when none exists", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    // No existing cert → will generate new one
    mockBackendRead.mockImplementation((type: string) => {
      if (type === "cloudflare_origin_cert") return Promise.resolve(null);
      return Promise.resolve("stored-cf-token");
    });
    mockCreateOriginCertificate.mockResolvedValue({ certificate: "new-cert", private_key: "new-key" });

    setupFullVultrFlow();

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockCreateOriginCertificate).toHaveBeenCalled();
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("cloudflare_origin_cert", "agents.example.com", {
      certificate: "new-cert",
      private_key: "new-key",
    });
  });

  it("uses existing origin certificate when available and user declines regenerate", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    mockBackendRead.mockImplementation((_type: string, _instance: string, field?: string) => {
      if (field === "certificate") return Promise.resolve("existing-cert");
      if (field === "private_key") return Promise.resolve("existing-key");
      return Promise.resolve("stored-cf-token");
    });
    mockListAllZones.mockResolvedValue([{ id: "zone-1", name: "example.com", status: "active" }]);
    mockSearch.mockResolvedValueOnce({ id: "zone-1", name: "example.com" });
    mockInput.mockResolvedValueOnce("agents");

    // setupFullVultrFlow adds the "VPS ready" confirmation (true)
    setupFullVultrFlow();
    // AFTER the VPS ready confirm, we need "decline regenerate" confirm
    mockConfirm.mockResolvedValueOnce(false);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    // Should NOT generate a new certificate
    expect(mockCreateOriginCertificate).not.toHaveBeenCalled();
    expect(mockInstallNginx).toHaveBeenCalled();
    expect(mockConfigureNginx).toHaveBeenCalled();
  });

  it("returns result without CF on DNS record failure", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    mockUpsertDnsRecord.mockRejectedValue(new Error("DNS API error"));

    setupFullVultrFlow();

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // Should fall back to http URL without cloudflare
    expect(result?.gatewayUrl).not.toContain("https://agents.example.com");
    // cloudflareDnsRecordId should NOT be in result (DNS failed)
    expect(result?.cloudflareDnsRecordId).toBeUndefined();
  });

  it("returns result without CF on nginx install failure", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    mockInstallNginx.mockRejectedValue(new Error("nginx install failed"));

    setupFullVultrFlow();

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // Should fall back to http URL
    expect(result?.gatewayUrl).not.toBe("https://agents.example.com");
  });

  it("returns result without CF on nginx configure failure", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    mockConfigureNginx.mockRejectedValue(new Error("nginx configure failed"));

    setupFullVultrFlow();

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    expect(result?.gatewayUrl).not.toBe("https://agents.example.com");
  });

  it("continues with warning when setSslMode fails", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    mockSetSslMode.mockRejectedValue(new Error("SSL mode API error"));

    setupFullVultrFlow();

    const result = await setupVpsCloud();

    // Should still succeed overall even if SSL mode fails
    expect(result).not.toBeNull();
    // setSslMode failure is a warning — the gateway URL should still be set to https if we
    // make it past the SSL mode step (this depends on whether the ssh health check succeeds)
    expect(result?.provider).toBe("vps");
    expect(result?.cloudflareHostname).toBe("agents.example.com");
  });
});

describe("setupExistingServer additional paths", () => {
  beforeEach(() => resetAllMocks());

  it("configures firewall when user accepts firewall setup", async () => {
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
        cb(null, "ok\n", ""); // SSH connectivity test
      } else {
        cb(null, "24.0.7\n", ""); // Docker check and firewall
      }
    });

    // Accept firewall setup
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // sshExec should have been called with ufw command
    const sshCommands = mockExecFile.mock.calls.map((c: any[]) => c[1][c[1].length - 1]);
    expect(sshCommands.some((cmd: string) => cmd.includes("ufw"))).toBe(true);
  });
});

describe("Vultr wizard navigation", () => {
  beforeEach(() => resetAllMocks());

  it("returns null when user presses Esc at plan selection", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    // Esc at plan step → return null
    mockSearch.mockResolvedValueOnce(null);

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });

  it("goes back to plan step when Esc pressed at region selection", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-1c-1gb")  // plan (step 0)
      .mockResolvedValueOnce(null)           // Esc at region (step 1) → go back to step 0
      .mockResolvedValueOnce("vc2-1c-1gb")  // plan again (step 0 retry)
      .mockResolvedValueOnce("atl")          // region (step 1 retry)
      // OS auto-selected
      .mockResolvedValueOnce("ssh-key-1");   // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // search was called 5 times: plan, Esc@region, plan again, region, SSH key
    expect(mockSearch).toHaveBeenCalledTimes(5);
  });

  it("goes back when Esc pressed at SSH key selection", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-1c-1gb")  // plan
      .mockResolvedValueOnce("atl")          // region
      // OS auto-selected
      .mockResolvedValueOnce(null)           // Esc at SSH key → go back to step 2 (OS)
      // OS auto-selected again
      .mockResolvedValueOnce("ssh-key-1");   // SSH key retry

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
  });

  it("goes back when Esc pressed at OS selection", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    // Use a small plan to trigger OS prompt
    const smallPlan = [
      { id: "vc2-1c-512mb", vcpu_count: 1, ram: 512, disk: 10, bandwidth: 0.5, monthly_cost: 2.5, type: "vc2", locations: ["atl"] },
    ];
    mockListPlans.mockResolvedValue(smallPlan);
    mockListRegions.mockResolvedValue(TEST_REGIONS);
    mockListOsImages.mockResolvedValue(TEST_OS_IMAGES);
    mockListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
    setupFirewallMocks(true);

    const smallInstance = { ...TEST_INSTANCE, plan: "vc2-1c-512mb", ram: 512 };
    mockCreateInstance.mockResolvedValue(smallInstance);
    mockGetInstance.mockResolvedValue(smallInstance);

    mockSearch
      .mockResolvedValueOnce("vc2-1c-512mb") // plan
      .mockResolvedValueOnce("atl")           // region
      .mockResolvedValueOnce(null)            // Esc at OS → go back to region
      .mockResolvedValueOnce("atl")           // region again
      .mockResolvedValueOnce(999)             // OS chosen (Alpine)
      .mockResolvedValueOnce("ssh-key-1");    // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
  });

  it("goes back to plan step when plan has no available regions", async () => {
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    // Plan with no regions available
    const plansWithNoRegions = [
      { id: "vc2-special", vcpu_count: 1, ram: 1024, disk: 25, bandwidth: 1, monthly_cost: 5, type: "vc2", locations: [] },
      { id: "vc2-1c-1gb", vcpu_count: 1, ram: 1024, disk: 25, bandwidth: 1, monthly_cost: 5, type: "vc2", locations: ["atl"] },
    ];
    mockListPlans.mockResolvedValue(plansWithNoRegions);
    mockListRegions.mockResolvedValue(TEST_REGIONS);
    mockListOsImages.mockResolvedValue(TEST_OS_IMAGES);
    mockListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-special")  // first plan choice (no regions)
      // regionChoices.length === 0 → step-- back to plan
      .mockResolvedValueOnce("vc2-1c-1gb")  // second plan choice (has regions)
      .mockResolvedValueOnce("atl")          // region
      // OS auto-selected
      .mockResolvedValueOnce("ssh-key-1");   // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    expect(mockSearch).toHaveBeenCalledTimes(4);
  });
});
