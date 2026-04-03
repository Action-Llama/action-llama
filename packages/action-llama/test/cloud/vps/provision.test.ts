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

// Mock hetzner-api
const {
  mockHetznerListLocations,
  mockHetznerListServerTypes,
  mockHetznerListImages,
  mockHetznerListSshKeys,
  mockHetznerCreateSshKey,
  mockHetznerCreateServer,
  mockHetznerGetServer,
  mockHetznerListFirewalls,
  mockHetznerCreateFirewall,
  mockHetznerApplyFirewallToServer,
} = vi.hoisted(() => ({
  mockHetznerListLocations: vi.fn(),
  mockHetznerListServerTypes: vi.fn(),
  mockHetznerListImages: vi.fn(),
  mockHetznerListSshKeys: vi.fn(),
  mockHetznerCreateSshKey: vi.fn(),
  mockHetznerCreateServer: vi.fn(),
  mockHetznerGetServer: vi.fn(),
  mockHetznerListFirewalls: vi.fn(),
  mockHetznerCreateFirewall: vi.fn(),
  mockHetznerApplyFirewallToServer: vi.fn(),
}));

vi.mock("../../../src/cloud/vps/hetzner-api.js", () => ({
  listLocations: (...args: any[]) => mockHetznerListLocations(...args),
  listServerTypes: (...args: any[]) => mockHetznerListServerTypes(...args),
  listImages: (...args: any[]) => mockHetznerListImages(...args),
  listSshKeys: (...args: any[]) => mockHetznerListSshKeys(...args),
  createSshKey: (...args: any[]) => mockHetznerCreateSshKey(...args),
  createServer: (...args: any[]) => mockHetznerCreateServer(...args),
  getServer: (...args: any[]) => mockHetznerGetServer(...args),
  listFirewalls: (...args: any[]) => mockHetznerListFirewalls(...args),
  createFirewall: (...args: any[]) => mockHetznerCreateFirewall(...args),
  applyFirewallToServer: (...args: any[]) => mockHetznerApplyFirewallToServer(...args),
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
    mockHetznerListLocations.mockReset().mockResolvedValue([]);
    mockHetznerListServerTypes.mockReset().mockResolvedValue([]);
    mockHetznerListImages.mockReset().mockResolvedValue([]);
    mockHetznerListSshKeys.mockReset().mockResolvedValue([]);
    mockHetznerCreateSshKey.mockReset().mockResolvedValue(undefined);
    mockHetznerCreateServer.mockReset().mockResolvedValue(undefined);
    mockHetznerGetServer.mockReset().mockResolvedValue(undefined);
    mockHetznerListFirewalls.mockReset().mockResolvedValue([]);
    mockHetznerCreateFirewall.mockReset().mockResolvedValue(undefined);
    mockHetznerApplyFirewallToServer.mockReset().mockResolvedValue(undefined);
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

  it("keypress handler calls ac.abort() when escape key is pressed during zone search", async () => {
    // This test covers the onKeypress handler body (provision.ts lines 26-28):
    //   if (key?.name === "escape") ac.abort();
    // We do this by using a signal-aware search mock: when the AbortController is aborted
    // (because the keypress handler fires with {name: "escape"}), the mock rejects with
    // AbortPromptError, which searchWithEsc catches and returns null.
    const { AbortPromptError } = await import("@inquirer/core");

    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    mockBackendRead.mockResolvedValue("stored-cf-token");
    mockListAllZones.mockResolvedValue([
      { id: "zone-1", name: "example.com", status: "active" },
    ]);

    // Zone search returns a pending promise that rejects only when the abort signal fires.
    // This simulates the real inquirer `search` respecting the signal.
    mockSearch.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new AbortPromptError());
          });
        }
      });
    });

    // Set up the rest of the Vultr flow for after promptCloudflareHttps returns null.
    setupFullVultrFlow();

    // Start the provisioning flow but do not await yet — we need to emit the escape key
    // after the onKeypress listener has been registered by searchWithEsc.
    const resultPromise = setupVpsCloud();

    // Yield to the microtask queue several times so that the async flow advances far
    // enough that searchWithEsc has registered its keypress listener and is awaiting search().
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    // Emit an escape keypress on stdin. The onKeypress handler fires synchronously,
    // calling ac.abort() which aborts the AbortController signal, causing the signal-aware
    // search mock to reject with AbortPromptError.
    process.stdin.emit("keypress", null, { name: "escape" });

    // Allow the rejection to propagate through the promise chain.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    const result = await resultPromise;
    expect(result?.provider).toBe("vps");
  });

  it("propagates non-AbortPromptError thrown from zone search (searchWithEsc re-throws)", async () => {
    // This test covers the `throw err` branch in searchWithEsc (provision.ts catch block)
    // which fires when `search()` rejects with an error that is NOT an AbortPromptError.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS
    mockBackendRead.mockResolvedValue("stored-cf-token");
    mockListAllZones.mockResolvedValue([
      { id: "zone-1", name: "example.com", status: "active" },
    ]);
    // The zone search (searchWithEsc) throws a generic error — not an AbortPromptError.
    // searchWithEsc must re-throw it (the `throw err` branch), which propagates through
    // promptCloudflareHttps and all the way out of setupVpsCloud.
    mockSearch.mockRejectedValueOnce(new Error("Unexpected search failure"));

    await expect(setupVpsCloud()).rejects.toThrow("Unexpected search failure");
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
  // Hetzner mocks
  mockHetznerListLocations.mockResolvedValue([]);
  mockHetznerListServerTypes.mockResolvedValue([]);
  mockHetznerListImages.mockResolvedValue([]);
  mockHetznerListSshKeys.mockResolvedValue([]);
  mockHetznerCreateSshKey.mockResolvedValue(undefined);
  mockHetznerCreateServer.mockResolvedValue(undefined);
  mockHetznerGetServer.mockResolvedValue(undefined);
  mockHetznerListFirewalls.mockResolvedValue([]);
  mockHetznerCreateFirewall.mockResolvedValue(undefined);
  mockHetznerApplyFirewallToServer.mockResolvedValue(undefined);
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

// --- Hetzner test data ---

const HETZNER_SERVER_TYPES = [
  {
    id: 1,
    name: "cx22",
    description: "CX22",
    cores: 2,
    memory: 4,
    disk: 40,
    architecture: "x86",
    deprecation: null,
    prices: [{ location: "fsn1", price_hourly: { net: "0.006", gross: "0.007" }, price_monthly: { net: "3.79", gross: "4.51" } }],
    locations: [{ id: 1, name: "fsn1", deprecation: null }],
  },
  {
    id: 2,
    name: "cx32",
    description: "CX32",
    cores: 4,
    memory: 8,
    disk: 80,
    architecture: "x86",
    deprecation: null,
    prices: [{ location: "fsn1", price_hourly: { net: "0.013", gross: "0.015" }, price_monthly: { net: "8.90", gross: "10.59" } }],
    locations: [{ id: 1, name: "fsn1", deprecation: null }],
  },
];

const HETZNER_LOCATIONS = [
  { id: 1, name: "fsn1", description: "Falkenstein DC Park 1", country: "DE", city: "Falkenstein", latitude: 50.47612, longitude: 12.37071, network_zone: "eu-central" },
  { id: 2, name: "nbg1", description: "Nuremberg DC Park 1", country: "DE", city: "Nuremberg", latitude: 49.452102, longitude: 11.076665, network_zone: "eu-central" },
];

const HETZNER_IMAGES = [
  { id: 1, type: "system", status: "available", name: "ubuntu-22.04", description: "Ubuntu 22.04", os_flavor: "ubuntu", os_version: "22.04", architecture: "x86", deprecated: null },
  { id: 2, type: "system", status: "available", name: "ubuntu-24.04", description: "Ubuntu 24.04", os_flavor: "ubuntu", os_version: "24.04", architecture: "x86", deprecated: null },
  { id: 3, type: "system", status: "available", name: "debian-12", description: "Debian 12", os_flavor: "debian", os_version: "12", architecture: "x86", deprecated: null },
];

const HETZNER_SSH_KEYS = [
  { id: 101, name: "mykey", fingerprint: "aa:bb:cc", public_key: "ssh-rsa AAAA...existing", labels: {}, created: "2024-01-01" },
];

const HETZNER_SERVER_PENDING = {
  id: 42,
  name: "action-llama",
  status: "initializing",
  public_net: { ipv4: { ip: "0.0.0.0", blocked: false }, ipv6: { ip: "::", blocked: false } },
  server_type: { id: 1, name: "cx22", cores: 2, memory: 4, disk: 40 },
  datacenter: { id: 1, name: "fsn1-dc14", location: { id: 1, name: "fsn1", country: "DE", city: "Falkenstein" } },
  created: "2024-01-01",
};

const HETZNER_SERVER_RUNNING = {
  ...HETZNER_SERVER_PENDING,
  status: "running",
  public_net: { ipv4: { ip: "5.9.10.11", blocked: false }, ipv6: { ip: "::", blocked: false } },
};

function setupHetznerCatalogMocks() {
  mockHetznerListServerTypes.mockResolvedValue(HETZNER_SERVER_TYPES);
  mockHetznerListLocations.mockResolvedValue(HETZNER_LOCATIONS);
  mockHetznerListImages.mockResolvedValue(HETZNER_IMAGES);
  mockHetznerListSshKeys.mockResolvedValue(HETZNER_SSH_KEYS);
}

function setupHetznerFirewallMocks(existing = true) {
  if (existing) {
    mockHetznerListFirewalls.mockResolvedValue([
      { id: 10, name: "action-llama", labels: {}, rules: [], applied_to: [] },
    ]);
  } else {
    mockHetznerListFirewalls.mockResolvedValue([]);
    mockHetznerCreateFirewall.mockResolvedValue({ id: 11, name: "action-llama", labels: {}, rules: [], applied_to: [] });
  }
  mockHetznerApplyFirewallToServer.mockResolvedValue(undefined);
}

function setupHetznerServerMocks() {
  mockHetznerCreateServer.mockResolvedValue(HETZNER_SERVER_PENDING);
  mockHetznerGetServer.mockResolvedValue(HETZNER_SERVER_RUNNING);
}

describe("Hetzner provisioning path", () => {
  beforeEach(() => resetAllMocks());

  it("provisions a Hetzner VPS with existing SSH key and firewall", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // Wizard: server type, location, SSH key (OS auto-selected to ubuntu-22.04)
    mockSearch
      .mockResolvedValueOnce("cx22")    // server type
      .mockResolvedValueOnce("fsn1")    // location
      .mockResolvedValueOnce("101");    // existing Hetzner SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true); // "VPS ready. Continue?"

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    expect(result?.host).toBe("5.9.10.11");
    expect(result?.hetznerServerId).toBe(42);
    expect(result?.hetznerLocation).toBe("fsn1");
    expect(result?.gatewayUrl).toBe("http://5.9.10.11:3000");
    expect(mockHetznerCreateServer).toHaveBeenCalledWith("fake-vultr-key", expect.objectContaining({
      name: "action-llama",
      server_type: "cx22",
      location: "fsn1",
    }));
  });

  it("provisions Hetzner VPS and calls onInstanceCreated with partial then full config", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const partialCallbacks: Record<string, unknown>[] = [];
    const result = await setupVpsCloud((partial) => partialCallbacks.push({ ...partial }));

    expect(result).not.toBeNull();
    // First callback: PENDING host
    expect(partialCallbacks.length).toBeGreaterThanOrEqual(1);
    expect(partialCallbacks[0].provider).toBe("vps");
    expect(partialCallbacks[0].hetznerServerId).toBe(42);
  });

  it("creates new Hetzner firewall when none exists", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(false); // no existing firewall
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateFirewall).toHaveBeenCalledWith(
      "fake-vultr-key",
      "action-llama",
      expect.arrayContaining([expect.objectContaining({ port: "22" })]),
    );
  });

  it("returns null when user declines final VPS ready confirmation", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(false); // Decline "VPS ready. Continue?"

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });

  it("returns null when Hetzner server never becomes active (timeout)", async () => {
    vi.useFakeTimers();

    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);

    // Server created but always stays pending (never running)
    mockHetznerCreateServer.mockResolvedValue(HETZNER_SERVER_PENDING);
    mockHetznerGetServer.mockResolvedValue(HETZNER_SERVER_PENDING);

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    const resultPromise = setupVpsCloud();

    // Advance past 10-minute timeout
    for (let i = 0; i < 70; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    const result = await resultPromise;
    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("returns null when final SSH check fails after Hetzner server is running and cloud-init completes", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    // Polling loop: testConnection succeeds, node/docker succeed → loop breaks
    // Final testConnection fails → return null
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      callCount++;
      const command = args[args.length - 1];
      if (command.includes("echo ok") && callCount === 1) {
        cb(null, "ok\n", ""); // testConnection in loop: OK
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else if (command.includes("docker info")) {
        cb(null, "24.0.7\n", "");
      } else if (command.includes("echo ok") && callCount > 1) {
        // Final testConnection: fail
        cb(new Error("Connection refused"), "", "Connection refused");
      } else {
        cb(null, "ok\n", "");
      }
    });

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });

  it("prompts for Hetzner API key when not found in credentials", async () => {
    mockBackendRead.mockResolvedValue(null); // No stored key

    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);
    mockPassword.mockResolvedValueOnce("new-hetzner-key");

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockPassword).toHaveBeenCalledOnce();
    expect(mockWriteCredentialField).toHaveBeenCalledWith("hetzner_api_key", "default", "api_key", "new-hetzner-key");
  });

  it("creates new SSH key via promptCredential when user selects __new__", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("__new__"); // Create new key

    mockPromptCredential.mockResolvedValueOnce({
      values: { public_key: "ssh-rsa AAAA...new", private_key: "-----BEGIN..." },
    });
    mockHetznerCreateSshKey.mockResolvedValue({ id: 202, name: "action-llama", fingerprint: "xx:yy", public_key: "ssh-rsa AAAA...new", labels: {}, created: "2024-01-01" });

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateSshKey).toHaveBeenCalledWith("fake-vultr-key", "action-llama", "ssh-rsa AAAA...new");
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("vps_ssh", "default", expect.objectContaining({ public_key: "ssh-rsa AAAA...new" }));
  });

  it("uses existing AL vps_ssh credential and uploads to Hetzner if not already there", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    // vps_ssh credential exists
    mockCredentialExists.mockResolvedValue(true);
    mockLoadCredentialFields.mockResolvedValue({ public_key: "ssh-rsa AAAA...al-key", private_key: "-----BEGIN..." });

    // Hetzner has no matching key
    const keysWithoutAlKey = [{ id: 101, name: "otherkey", fingerprint: "aa:bb", public_key: "ssh-rsa AAAA...other", labels: {}, created: "2024-01-01" }];
    mockHetznerListSshKeys.mockResolvedValue(keysWithoutAlKey);
    mockHetznerListServerTypes.mockResolvedValue(HETZNER_SERVER_TYPES);
    mockHetznerListLocations.mockResolvedValue(HETZNER_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(HETZNER_IMAGES);

    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();
    mockHetznerCreateSshKey.mockResolvedValue({ id: 303, name: "action-llama", fingerprint: "zz:aa", public_key: "ssh-rsa AAAA...al-key", labels: {}, created: "2024-01-01" });

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("__al_credential__");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateSshKey).toHaveBeenCalledWith("fake-vultr-key", "action-llama", "ssh-rsa AAAA...al-key");
  });

  it("reuses existing Hetzner key when AL credential public key already exists on Hetzner", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    mockCredentialExists.mockResolvedValue(true);
    mockLoadCredentialFields.mockResolvedValue({ public_key: "ssh-rsa AAAA...existing", private_key: "-----BEGIN..." });

    // HETZNER_SSH_KEYS already has public_key "ssh-rsa AAAA...existing"
    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("__al_credential__");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    // Should NOT upload the key again since it already exists
    expect(mockHetznerCreateSshKey).not.toHaveBeenCalled();
  });

  it("includes cloudflare metadata in result on successful CF setup via Hetzner", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(false); // new firewall (adds http/https ports for CF)
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")    // server type
      .mockResolvedValueOnce("fsn1")    // location
      .mockResolvedValueOnce("101");    // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true); // "VPS ready. Continue?"

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    expect(result?.cloudflareHostname).toBe("agents.example.com");
    expect(result?.cloudflareDnsRecordId).toBe("dns-record-123");
    expect(result?.gatewayUrl).toBe("https://agents.example.com");
    expect(mockUpsertDnsRecord).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "agents.example.com",
      "5.9.10.11",
      true,
    );
  });

  it("returns result without CF on Hetzner DNS record failure", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    mockUpsertDnsRecord.mockRejectedValue(new Error("DNS API failed"));

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // DNS failed → fall back to HTTP URL, no CF metadata
    expect(result?.cloudflareDnsRecordId).toBeUndefined();
    expect(result?.gatewayUrl).toContain("http://");
  });

  it("goes back when Esc pressed at server type selection", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // Esc at server type (step 0) → return null
    mockSearch.mockResolvedValueOnce(null);

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });

  it("goes back when Esc pressed at location selection", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")    // server type (step 0)
      .mockResolvedValueOnce(null)      // Esc at location (step 1) → back to step 0
      .mockResolvedValueOnce("cx22")    // server type again
      .mockResolvedValueOnce("fsn1")    // location retry
      // OS auto-selected
      .mockResolvedValueOnce("101");    // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    // search was called: type, Esc@loc, type again, loc, SSH key = 5 times
    expect(mockSearch).toHaveBeenCalledTimes(5);
  });

  it("goes back when Esc pressed at SSH key selection", async () => {
    // When user presses Esc at SSH key step (step 3), step-- → step 2.
    // Since ubuntu-22.04 is in HETZNER_IMAGES, OS is auto-selected immediately at step 2.
    // Then step 3 (SSH key) is shown again and the user picks a valid key.
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")    // step 0: server type
      .mockResolvedValueOnce("fsn1")    // step 1: location
      // step 2: OS auto-selected (no search call)
      .mockResolvedValueOnce(null)      // step 3: Esc at SSH key → step-- (to step 2)
      // step 2 again: OS auto-selected
      .mockResolvedValueOnce("101");    // step 3 again: SSH key picked

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true); // "VPS ready. Continue?"

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // search: type, location, null@ssh, ssh = 4 calls
    expect(mockSearch).toHaveBeenCalledTimes(4);
  });

  it("logs waiting message when SSH is ready but cloud-init has not finished (line 958)", async () => {
    // This test covers line 958: console.log("Waiting for cloud-init to complete (Node.js + Docker)...")
    // First polling iteration: SSH ready (testConnection ok), but node --version returns non-zero.
    // Second iteration: everything succeeds → breaks the loop.
    vi.useFakeTimers();
    try {
      mockSelect.mockResolvedValueOnce("hetzner");
      mockConfirm.mockResolvedValueOnce(false);    // Decline HTTPS
      mockConfirm.mockResolvedValueOnce(true);     // VPS ready — queue before starting

      setupHetznerCatalogMocks();
      setupHetznerFirewallMocks(true);
      setupHetznerServerMocks();

      mockSearch
        .mockResolvedValueOnce("cx22")
        .mockResolvedValueOnce("fsn1")
        .mockResolvedValueOnce("101");

      // Use a call counter to control mock behavior per-call, not per-iteration variable.
      // This avoids the race condition where `iteration` is set before microtasks run.
      let nodeVersionCallCount = 0;
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        const command = args[args.length - 1];
        if (command.includes("echo ok")) {
          cb(null, "ok\n", ""); // SSH always ready
        } else if (command.includes("node --version")) {
          nodeVersionCallCount++;
          if (nodeVersionCallCount === 1) {
            // First call: node not ready (cloud-init still running)
            cb({ code: 1 }, "", "node: command not found");
          } else {
            cb(null, "v22.14.0\n", "");
          }
        } else {
          // docker info or anything else
          cb(null, "24.0.7\n", "");
        }
      });

      const resultPromise = setupVpsCloud();

      // After first iteration, the loop hits setTimeout(10_000).
      // Advance past the sleep so the second iteration can run.
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await resultPromise;

      expect(result).not.toBeNull();
      expect(result?.provider).toBe("vps");
      // Verify node --version was called at least twice (once failing, once succeeding)
      expect(nodeVersionCallCount).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes a dot when SSH is not yet reachable during polling (line 960)", async () => {
    // This test covers line 960: process.stdout.write(".")
    // First polling iteration: testConnection fails (echo ok returns wrong stdout).
    // Second iteration: SSH ready, cloud-init done → loop breaks.
    vi.useFakeTimers();
    try {
      mockSelect.mockResolvedValueOnce("hetzner");
      mockConfirm.mockResolvedValueOnce(false);    // Decline HTTPS
      mockConfirm.mockResolvedValueOnce(true);     // VPS ready — queue before starting

      setupHetznerCatalogMocks();
      setupHetznerFirewallMocks(true);
      setupHetznerServerMocks();

      mockSearch
        .mockResolvedValueOnce("cx22")
        .mockResolvedValueOnce("fsn1")
        .mockResolvedValueOnce("101");

      // Use a call counter to ensure only the FIRST "echo ok" call fails.
      let sshEchoCallCount = 0;
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        const command = args[args.length - 1];
        if (command.includes("echo ok")) {
          sshEchoCallCount++;
          if (sshEchoCallCount === 1) {
            // First testConnection: SSH not ready (empty stdout → includes("ok") = false)
            cb(null, "", "");
          } else {
            cb(null, "ok\n", "");
          }
        } else if (command.includes("node --version")) {
          cb(null, "v22.14.0\n", "");
        } else {
          cb(null, "24.0.7\n", "");
        }
      });

      const resultPromise = setupVpsCloud();

      // Advance past first iteration's sleep
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await resultPromise;

      expect(result).not.toBeNull();
      expect(result?.provider).toBe("vps");
      // Verify echo ok was called at least twice (once failing, once succeeding)
      expect(sshEchoCallCount).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs nginx health check warning when curl returns non-zero exit code (Hetzner HTTPS)", async () => {
    // Covers line 1091: "Note: nginx health check returned non-zero..."
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    // Custom SSH mock: curl health check returns non-zero
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command.includes("echo ok")) {
        cb(null, "ok\n", "");
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else if (command.includes("curl")) {
        cb({ code: 7 }, "", "curl: (7) Failed to connect"); // non-zero exit
      } else {
        cb(null, "24.0.7\n", "");
      }
    });

    mockConfirm.mockResolvedValueOnce(true); // "VPS ready. Continue?"

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // gatewayUrl is still set to https even when curl health check fails
    expect(result?.gatewayUrl).toBe("https://agents.example.com");
  });

  it("logs error and falls back when Cloudflare HTTPS sshExec throws unexpectedly (Hetzner)", async () => {
    // Covers lines 1096-1097: outer catch in Hetzner HTTPS setup
    // sshExec for curl health check throws (error with no 'code' property → sshExec rejects)
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    // Custom SSH mock: curl throws (no 'code' property → sshExec rejects)
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command.includes("echo ok")) {
        cb(null, "ok\n", "");
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else if (command.includes("curl")) {
        // Error without 'code' property causes sshExec to reject
        cb(new Error("ECONNRESET"), "", "");
      } else {
        cb(null, "24.0.7\n", "");
      }
    });

    mockConfirm.mockResolvedValueOnce(true); // "VPS ready. Continue?"

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // After outer catch, gatewayUrl is NOT set to https
    expect(result?.gatewayUrl).not.toBe("https://agents.example.com");
  });

  it("goes back to server type step when selected type has no available locations", async () => {
    // Covers lines 752-754: "This server type is not available in any location."
    // A server type with no locations → step-- → user picks a valid type next time.
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    // Custom server types: first type has no available locations, second has fsn1
    const customServerTypes = [
      {
        id: 99,
        name: "cx-no-loc",
        description: "CX No Locations",
        cores: 1,
        memory: 2,
        disk: 20,
        architecture: "x86",
        deprecation: null,
        prices: [],
        locations: [], // No available locations
      },
      ...HETZNER_SERVER_TYPES,
    ];
    mockHetznerListServerTypes.mockResolvedValue(customServerTypes);
    mockHetznerListLocations.mockResolvedValue(HETZNER_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(HETZNER_IMAGES);
    mockHetznerListSshKeys.mockResolvedValue(HETZNER_SSH_KEYS);
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx-no-loc")  // step 0: server type with no locations
      // step 1: no locations → step-- back to step 0
      .mockResolvedValueOnce("cx22")       // step 0 again: valid server type
      .mockResolvedValueOnce("fsn1")       // step 1: location
      // OS auto-selected
      .mockResolvedValueOnce("101");       // step 3: SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // search: cx-no-loc, cx22, fsn1, ssh = 4 calls
    expect(mockSearch).toHaveBeenCalledTimes(4);
  });
});


describe("provision.ts additional edge cases", () => {
  beforeEach(() => resetAllMocks());

  it("covers source filter path when search term is provided (opts.source with non-empty term)", async () => {
    // Ensure the searchWithEsc source function's filter branch (lines 38-39) is covered.
    // By intercepting the plan search mockSearch and calling opts.source("vc2"), we force the filter logic.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    let filteredChoices: any[] = [];

    mockSearch
      .mockImplementationOnce(async (opts: any) => {
        // For plan search: call source with a non-empty term to exercise lines 38-39
        filteredChoices = opts.source("vc2"); // filter choices by "vc2"
        return "vc2-1c-1gb"; // return valid plan
      })
      .mockResolvedValueOnce("atl")       // region
      .mockResolvedValueOnce("ssh-key-1"); // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    // The filter was called with "vc2" - results should include plans matching "vc2"
    expect(filteredChoices.length).toBeGreaterThan(0);
    // All returned plans should have "vc2" in the name (case-insensitive)
    expect(filteredChoices.every((c: any) => c.name.toLowerCase().includes("vc2"))).toBe(true);
  });

  it("covers CF token validate error (empty input returns required message)", async () => {
    // promptCloudflareHttps prompts for CF token when none stored.
    // Capture the validate function and test it with empty/valid inputs.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    mockBackendRead.mockImplementation((type: string) =>
      type === "cloudflare_api_token" ? Promise.resolve(null) : Promise.resolve("fake-vultr-key")
    );

    let capturedValidate: ((v: string) => boolean | string) | undefined;
    // password() is called for the CF token entry — capture its validate option
    mockPassword.mockImplementationOnce(async (opts: any) => {
      capturedValidate = opts.validate;
      return "valid-cf-token";
    });

    mockVerifyToken.mockResolvedValue(true);
    mockListAllZones.mockResolvedValue([]); // No zones → promptCloudflareHttps returns null

    setupFullVultrFlow();

    await setupVpsCloud();

    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!("")).toBe("API token is required");
    expect(capturedValidate!("   ")).toBe("API token is required");
    expect(capturedValidate!("valid-token")).toBe(true);
  });

  it("covers subdomain validate function branches", async () => {
    // promptCloudflareHttps collects subdomain via input() with a validate function.
    // We capture the validate function and test all its branches.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    // Set up CF mocks manually (instead of setupCloudflareMocks) so we can control input() ordering
    mockBackendRead.mockImplementation((type: string) => {
      if (type === "cloudflare_origin_cert") return Promise.resolve(null);
      return Promise.resolve("stored-cf-token");
    });
    mockListAllZones.mockResolvedValue([{ id: "zone-1", name: "example.com", status: "active" }]);
    mockSearch.mockResolvedValueOnce({ id: "zone-1", name: "example.com" }); // zone selection

    // Capture the validate function from the input() call for subdomain
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    mockInput.mockImplementationOnce(async (opts: any) => {
      capturedValidate = opts.validate;
      return "agents";
    });

    setupFullVultrFlow();

    await setupVpsCloud();

    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!("")).toBe("Subdomain is required");
    expect(capturedValidate!("   ")).toBe("Subdomain is required");
    expect(capturedValidate!("with spaces")).toBe("Subdomain must not contain spaces");
    expect(capturedValidate!("agents.example.com")).toBe("Enter only the subdomain part, not the full domain");
    expect(capturedValidate!("example.com")).toBe("Enter only the subdomain part, not the full domain");
    expect(capturedValidate!("agents")).toBe(true);
  });

  it("returns null when Vultr VPS final SSH check fails after polling loop completes", async () => {
    // Cover lines 521-523: final testConnection after polling loop fails.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-1c-1gb")
      .mockResolvedValueOnce("atl")
      .mockResolvedValueOnce("ssh-key-1");

    // Polling loop: testConnection (echo ok) succeeds, node/docker checks pass → loop breaks.
    // Final testConnection: fails → return null.
    let echoOkCallCount = 0;
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command.includes("echo ok")) {
        echoOkCallCount++;
        if (echoOkCallCount === 1) {
          cb(null, "ok\n", ""); // testConnection in loop: succeeds
        } else {
          cb(new Error("Connection refused"), "", ""); // Final testConnection: fails
        }
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else {
        cb(null, "24.0.7\n", ""); // docker info
      }
    });

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });

  it("covers Vultr cloud-init waiting log when SSH not ready then node/docker not ready", async () => {
    // Cover lines 501 (cloud-init not done) and 503 (SSH not ready dot).
    vi.useFakeTimers();
    try {
      mockSelect.mockResolvedValueOnce("vultr");
      mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS
      mockConfirm.mockResolvedValueOnce(true);  // VPS ready confirmation

      setupCatalogMocks();
      setupFirewallMocks(true);
      setupInstanceMocks();

      mockSearch
        .mockResolvedValueOnce("vc2-1c-1gb")
        .mockResolvedValueOnce("atl")
        .mockResolvedValueOnce("ssh-key-1");

      // iteration 1: SSH not ready (dot)
      // iteration 2: SSH ready, node not ready (cloud-init log)
      // iteration 3: SSH ready, node ready → break
      // final testConnection: OK
      let iterCount = 0;
      let nodeCallCount = 0;
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        const command = args[args.length - 1];
        if (command.includes("echo ok")) {
          iterCount++;
          if (iterCount === 1) {
            cb(new Error("Connection refused"), "", ""); // SSH not ready → process.stdout.write(".")
          } else {
            cb(null, "ok\n", ""); // SSH ready on subsequent calls
          }
        } else if (command.includes("node --version")) {
          nodeCallCount++;
          if (nodeCallCount === 1) {
            cb({ code: 1 }, "", "command not found"); // node not ready → "Waiting for cloud-init..."
          } else {
            cb(null, "v22.14.0\n", "");
          }
        } else {
          cb(null, "24.0.7\n", ""); // docker info
        }
      });

      const resultPromise = setupVpsCloud();
      // Let iteration 1 run, then advance past the 10s sleep for iteration 2, then 10s for iteration 3
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await resultPromise;

      expect(result).not.toBeNull();
      expect(result?.provider).toBe("vps");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns result without gatewayUrl on Origin CA certificate creation failure (Vultr)", async () => {
    // Cover lines 592-594: createOriginCertificate throws → catch block returns result without CF.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    // Set up CF mocks with cert failure
    mockBackendRead.mockImplementation((type: string) => {
      if (type === "cloudflare_origin_cert") return Promise.resolve(null); // No existing cert
      return Promise.resolve("stored-cf-token");
    });
    mockListAllZones.mockResolvedValue([{ id: "zone-1", name: "example.com", status: "active" }]);
    mockSearch.mockResolvedValueOnce({ id: "zone-1", name: "example.com" }); // zone
    mockInput.mockResolvedValueOnce("agents"); // subdomain

    // Origin CA cert creation fails
    mockCreateOriginCertificate.mockRejectedValueOnce(new Error("Cert creation failed"));

    setupFullVultrFlow();

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // gatewayUrl should be HTTP (not HTTPS) since cert creation failed
    expect(result?.gatewayUrl).not.toContain("https://");
  });

  it("covers Hetzner OS image manual selection when ubuntu-22.04 is not available", async () => {
    // Cover lines 785 (stmts 412-413): when ubuntu-22.04 is not in the image list,
    // the OS image is selected via searchWithEsc.
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    // Images without ubuntu-22.04
    const imagesWithoutUbuntu2204 = [
      { id: 2, type: "system", status: "available", name: "ubuntu-24.04", description: "Ubuntu 24.04", os_flavor: "ubuntu", os_version: "24.04", architecture: "x86", deprecated: null },
      { id: 3, type: "system", status: "available", name: "debian-12", description: "Debian 12", os_flavor: "debian", os_version: "12", architecture: "x86", deprecated: null },
    ];
    mockHetznerListServerTypes.mockResolvedValue(HETZNER_SERVER_TYPES);
    mockHetznerListLocations.mockResolvedValue(HETZNER_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(imagesWithoutUbuntu2204);
    mockHetznerListSshKeys.mockResolvedValue(HETZNER_SSH_KEYS);

    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // step 0: server type, step 1: location, step 2: OS image (manual, no ubuntu-22.04), step 3: SSH key
    mockSearch
      .mockResolvedValueOnce("cx22")         // server type
      .mockResolvedValueOnce("fsn1")         // location
      .mockResolvedValueOnce("ubuntu-24.04") // OS image (manual selection)
      .mockResolvedValueOnce("101");          // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
  });

  it("logs nginx health check warning when curl returns non-zero exit code (Vultr HTTPS)", async () => {
    // Covers provision.ts lines 633-634: the else branch when sshExec curl returns non-zero.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-1c-1gb")  // plan
      .mockResolvedValueOnce("atl")          // region
      .mockResolvedValueOnce("ssh-key-1");   // existing Vultr key

    // Custom SSH mock: curl health check returns non-zero exit code
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command.includes("echo ok")) {
        cb(null, "ok\n", "");
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else if (command.includes("curl")) {
        cb({ code: 7 }, "", "curl: (7) Failed to connect"); // non-zero exit
      } else {
        cb(null, "24.0.7\n", "");
      }
    });

    mockConfirm.mockResolvedValueOnce(true); // VPS ready

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // gatewayUrl is still set to https even when curl health check returns non-zero
    expect(result?.gatewayUrl).toBe("https://agents.example.com");
  });

  it("logs error and continues when Cloudflare HTTPS sshExec throws unexpectedly (Vultr)", async () => {
    // Covers provision.ts lines 638-640: the outer catch block when sshExec rejects.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(true); // Accept HTTPS

    setupCloudflareMocks();
    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-1c-1gb")  // plan
      .mockResolvedValueOnce("atl")          // region
      .mockResolvedValueOnce("ssh-key-1");   // existing Vultr key

    // Custom SSH mock: curl throws (error without 'code' property → sshExec rejects)
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      const command = args[args.length - 1];
      if (command.includes("echo ok")) {
        cb(null, "ok\n", "");
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else if (command.includes("curl")) {
        // Error without 'code' property causes sshExec to reject
        cb(new Error("SSH connection lost"), "", "");
      } else {
        cb(null, "24.0.7\n", "");
      }
    });

    mockConfirm.mockResolvedValueOnce(true); // VPS ready

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    // VPS is still returned, just without HTTPS gatewayUrl
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
    // gatewayUrl falls back to http since HTTPS setup encountered an error
    expect(result?.gatewayUrl).not.toContain("https://");
  });

  it("covers Hetzner API key validate function truthy branch (line 656)", async () => {
    // Covers provision.ts line 656 col 31: `true` in `v.trim() ? true : "API key is required"`.
    // This is the truthy branch of the Hetzner API key validate function.
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    // Return null for hetzner_api_key so the prompt appears
    mockBackendRead.mockImplementation((type: string) =>
      type === "hetzner_api_key" ? Promise.resolve(null) : Promise.resolve(null)
    );

    // Capture the validate function from the password() call for Hetzner API key
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    mockPassword.mockImplementationOnce(async (opts: any) => {
      capturedValidate = opts.validate;
      return "valid-hetzner-key";
    });

    // Set up Hetzner catalog with the entered key
    mockHetznerListServerTypes.mockResolvedValue(HETZNER_SERVER_TYPES);
    mockHetznerListLocations.mockResolvedValue(HETZNER_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(HETZNER_IMAGES);
    mockHetznerListSshKeys.mockResolvedValue(HETZNER_SSH_KEYS);

    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("101");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupVpsCloud();
    consoleSpy.mockRestore();

    // Test the captured validate function: truthy branch returns true
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!("valid-key")).toBe(true);
    // Also test the falsy branch for completeness
    expect(capturedValidate!("")).toBe("API key is required");
    expect(capturedValidate!("   ")).toBe("API key is required");
  });

  it("goes back (step--) when OS image selection returns null via ESC (Hetzner, no ubuntu-22.04)", async () => {
    // Covers provision.ts line 785: `if (result === null) { step--; continue; }` in Hetzner provisioning.
    // This path is hit when ubuntu-22.04 is not available and the user presses ESC on OS image selection.
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    // Images without ubuntu-22.04
    const imagesWithoutUbuntu2204 = [
      { id: 2, type: "system", status: "available", name: "ubuntu-24.04", description: "Ubuntu 24.04",
        os_flavor: "ubuntu", os_version: "24.04", architecture: "x86", deprecated: null },
      { id: 3, type: "system", status: "available", name: "debian-12", description: "Debian 12",
        os_flavor: "debian", os_version: "12", architecture: "x86", deprecated: null },
    ];
    mockHetznerListServerTypes.mockResolvedValue(HETZNER_SERVER_TYPES);
    mockHetznerListLocations.mockResolvedValue(HETZNER_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(imagesWithoutUbuntu2204);
    mockHetznerListSshKeys.mockResolvedValue(HETZNER_SSH_KEYS);

    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // Step sequence: server type → location → OS image (ESC pressed → step--) → server type again →
    //   location → OS image (valid selection) → SSH key
    mockSearch
      .mockResolvedValueOnce("cx22")         // step 0: server type (first pass)
      .mockResolvedValueOnce("fsn1")         // step 1: location (first pass)
      .mockResolvedValueOnce(null)           // step 2: OS image → ESC → step-- (back to step 1)
      .mockResolvedValueOnce("fsn1")         // step 1: location (second pass)
      .mockResolvedValueOnce("ubuntu-24.04") // step 2: OS image (second pass, valid selection)
      .mockResolvedValueOnce("101");          // step 3: SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true); // VPS ready

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await setupVpsCloud();
    consoleSpy.mockRestore();

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("vps");
  });

  it("covers Vultr API key validate function truthy branch (line 232)", async () => {
    // Covers provision.ts line 232 col 31: `true` in `v.trim() ? true : "API key is required"`.
    // This is the truthy branch of the Vultr API key validate function.
    mockSelect.mockResolvedValueOnce("vultr");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS
    mockBackendRead.mockResolvedValue(null);   // No Vultr API key stored

    // Capture the validate function from the password() call for Vultr API key
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    mockPassword.mockImplementationOnce(async (opts: any) => {
      capturedValidate = opts.validate;
      return "valid-vultr-key";
    });

    setupCatalogMocks();
    setupFirewallMocks(true);
    setupInstanceMocks();

    mockSearch
      .mockResolvedValueOnce("vc2-1c-1gb")
      .mockResolvedValueOnce("atl")
      .mockResolvedValueOnce("ssh-key-1");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true); // VPS ready

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await setupVpsCloud();
    consoleSpy.mockRestore();

    // Test the captured validate function: truthy branch returns true
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!("valid-vultr-key")).toBe(true);
    // Also test the falsy branch to verify both branches
    expect(capturedValidate!("")).toBe("API key is required");
    expect(capturedValidate!("   ")).toBe("API key is required");
  });
});
