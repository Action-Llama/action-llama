/**
 * Tests for the Hetzner provisioning path in setupVpsCloud.
 * Covers the provisionHetzner function and its branches.
 */
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
  mockBackendRead: vi.fn().mockResolvedValue("fake-hetzner-key"),
}));

vi.mock("../../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = mockBackendRead;
  },
}));

// Mock credentials
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

// Mock vultr-api (not used in hetzner path, but provision.ts imports it dynamically)
vi.mock("../../../src/cloud/vps/vultr-api.js", () => ({
  listPlans: vi.fn(),
  listRegions: vi.fn(),
  listOsImages: vi.fn(),
  listSshKeys: vi.fn(),
  createSshKey: vi.fn(),
  createInstance: vi.fn(),
  getInstance: vi.fn(),
  listFirewallGroups: vi.fn(),
  createFirewallGroup: vi.fn(),
  createFirewallRule: vi.fn(),
  listFirewallRules: vi.fn(),
}));

const { setupVpsCloud } = await import("../../../src/cloud/vps/provision.js");

// --- Hetzner Test Data ---

const TEST_SERVER_TYPES = [
  {
    id: 1,
    name: "cx22",
    description: "CX22",
    cores: 2,
    memory: 4,
    disk: 40,
    architecture: "x86",
    deprecation: null,
    prices: [{ location: "fsn1", price_hourly: { net: "0.00", gross: "0.00" }, price_monthly: { net: "4.15", gross: "4.90" } }],
    locations: [{ id: 1, name: "fsn1", deprecation: null }, { id: 2, name: "nbg1", deprecation: null }],
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
    prices: [{ location: "fsn1", price_hourly: { net: "0.00", gross: "0.00" }, price_monthly: { net: "8.30", gross: "9.90" } }],
    locations: [{ id: 1, name: "fsn1", deprecation: null }],
  },
];

const TEST_LOCATIONS = [
  { id: 1, name: "fsn1", description: "Falkenstein DC Park 1", country: "DE", city: "Falkenstein", latitude: 50.47612, longitude: 12.37016, network_zone: "eu-central" },
  { id: 2, name: "nbg1", description: "Nuremberg DC Park 1", country: "DE", city: "Nuremberg", latitude: 49.45203, longitude: 11.07576, network_zone: "eu-central" },
  { id: 3, name: "hel1", description: "Helsinki DC Park 1", country: "FI", city: "Helsinki", latitude: 60.16952, longitude: 24.93545, network_zone: "eu-central" },
];

const TEST_IMAGES = [
  { id: 1, type: "system", status: "available", name: "ubuntu-22.04", description: "Ubuntu 22.04", os_flavor: "ubuntu", os_version: "22.04", architecture: "x86", deprecated: null },
  { id: 2, type: "system", status: "available", name: "debian-12", description: "Debian 12", os_flavor: "debian", os_version: "12", architecture: "x86", deprecated: null },
  { id: 3, type: "system", status: "available", name: "fedora-40", description: "Fedora 40", os_flavor: "fedora", os_version: "40", architecture: "x86", deprecated: null },
  { id: 4, type: "system", status: "available", name: "ubuntu-arm64", description: "Ubuntu 22.04 arm64", os_flavor: "ubuntu", os_version: "22.04", architecture: "arm", deprecated: null },
  { id: 5, type: "system", status: "available", name: "windows-2022", description: "Windows Server 2022", os_flavor: "windows", os_version: "2022", architecture: "x86", deprecated: null },
];

const TEST_SSH_KEYS = [
  { id: 1, name: "mykey", fingerprint: "aa:bb:cc", public_key: "ssh-rsa AAAA...", labels: {}, created: "2024-01-01" },
];

const TEST_SERVER = {
  id: 42,
  name: "action-llama",
  status: "running",
  public_net: {
    ipv4: { ip: "10.20.30.40", blocked: false },
    ipv6: { ip: "2001:db8::1", blocked: false },
  },
  server_type: { id: 1, name: "cx22", cores: 2, memory: 4, disk: 40 },
  datacenter: { id: 1, name: "fsn1-dc14", location: { id: 1, name: "fsn1", country: "DE", city: "Falkenstein" } },
  created: "2024-01-01T00:00:00Z",
};

const TEST_FIREWALL = {
  id: 10,
  name: "action-llama",
  rules: [],
  applied_to: [],
};

// --- Setup helpers ---

function setupHetznerCatalogMocks() {
  mockHetznerListServerTypes.mockResolvedValue(TEST_SERVER_TYPES);
  mockHetznerListLocations.mockResolvedValue(TEST_LOCATIONS);
  mockHetznerListImages.mockResolvedValue(TEST_IMAGES);
  mockHetznerListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
}

function setupHetznerFirewallMocks(existing = true) {
  if (existing) {
    mockHetznerListFirewalls.mockResolvedValue([TEST_FIREWALL]);
  } else {
    mockHetznerListFirewalls.mockResolvedValue([]);
    mockHetznerCreateFirewall.mockResolvedValue(TEST_FIREWALL);
  }
}

function setupHetznerServerMocks() {
  mockHetznerCreateServer.mockResolvedValue(TEST_SERVER);
  mockHetznerGetServer.mockResolvedValue(TEST_SERVER);
}

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

describe("Hetzner VPS provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackendRead.mockResolvedValue("fake-hetzner-key");
    mockWriteCredentialField.mockResolvedValue(undefined);
    mockWriteCredentialFields.mockResolvedValue(undefined);
    mockLoadCredentialFields.mockResolvedValue(undefined);
    mockCredentialExists.mockResolvedValue(false);
  });

  it("provisions with existing Hetzner SSH key and existing firewall", async () => {
    // Mode: hetzner
    mockSelect.mockResolvedValueOnce("hetzner");

    // Decline Cloudflare HTTPS
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true); // existing firewall
    setupHetznerServerMocks();

    // searchWithEsc calls: server type, location, (OS auto-selected), SSH key
    mockSearch
      .mockResolvedValueOnce("cx22")       // server type
      .mockResolvedValueOnce("fsn1")       // location
      // OS auto-selected (ubuntu-22.04)
      .mockResolvedValueOnce("1");         // existing SSH key id as string

    setupSshMocks();

    // Final confirmation
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(result).toEqual(expect.objectContaining({
      provider: "vps",
      host: "10.20.30.40",
      hetznerServerId: 42,
      hetznerLocation: "fsn1",
      gatewayUrl: "http://10.20.30.40:3000",
    }));

    expect(mockHetznerCreateServer).toHaveBeenCalledWith("fake-hetzner-key", expect.objectContaining({
      name: "action-llama",
      server_type: "cx22",
      location: "fsn1",
      ssh_keys: [1],
    }));
  });

  it("prompts for API key when not found in credentials", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS
    mockBackendRead.mockResolvedValue(null); // No API key stored

    // Password prompt for API key
    mockPassword.mockResolvedValueOnce("  new-hetzner-key  ");

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    setupSshMocks();

    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockWriteCredentialField).toHaveBeenCalledWith(
      "hetzner_api_key", "default", "api_key", "new-hetzner-key",
    );
    expect(mockHetznerListServerTypes).toHaveBeenCalledWith("new-hetzner-key");
  });

  it("creates new firewall when none exists", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(false); // no existing firewall
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    setupSshMocks();

    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateFirewall).toHaveBeenCalledWith(
      "fake-hetzner-key",
      "action-llama",
      expect.arrayContaining([
        expect.objectContaining({ port: "22", description: "SSH" }),
      ])
    );
  });

  it("returns null when user declines final confirmation", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    setupSshMocks();

    // User declines at final confirmation
    mockConfirm.mockResolvedValueOnce(false);

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });

  it("calls onInstanceCreated callback with partial config", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    setupSshMocks();

    mockConfirm.mockResolvedValueOnce(true);

    const onInstanceCreated = vi.fn();
    await setupVpsCloud(onInstanceCreated);

    expect(onInstanceCreated).toHaveBeenCalled();
    const firstCall = onInstanceCreated.mock.calls[0][0];
    expect(firstCall).toHaveProperty("hetznerServerId", 42);
    expect(firstCall).toHaveProperty("provider", "vps");
  });

  it("creates new SSH key via promptCredential when user selects __new__", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      // OS auto-selected
      .mockResolvedValueOnce("__new__"); // new SSH key

    // promptCredential returns a keypair
    mockPromptCredential.mockResolvedValueOnce({
      values: { private_key: "PRIV_KEY", public_key: "ssh-ed25519 HETZ..." },
    });

    // createSshKey uploads to Hetzner
    mockHetznerCreateSshKey.mockResolvedValueOnce({ id: 99, name: "action-llama", fingerprint: "xx:yy", public_key: "ssh-ed25519 HETZ...", labels: {}, created: "2024-01-01" });

    setupSshMocks();

    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockPromptCredential).toHaveBeenCalled();
    expect(mockWriteCredentialFields).toHaveBeenCalledWith("vps_ssh", "default", {
      private_key: "PRIV_KEY",
      public_key: "ssh-ed25519 HETZ...",
    });
    expect(mockHetznerCreateSshKey).toHaveBeenCalledWith("fake-hetzner-key", "action-llama", "ssh-ed25519 HETZ...");
    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ssh_keys: [99],
    }));
    expect(result).toHaveProperty("sshKeyPath", "/mock-creds/vps_ssh/default/private_key");
  });

  it("uses existing AL vps_ssh credential and uploads to Hetzner", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // vps_ssh credential exists
    mockCredentialExists.mockResolvedValue(true);
    mockLoadCredentialFields.mockResolvedValue({
      private_key: "PRIV_KEY",
      public_key: "ssh-ed25519 AL...",
    });

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("__al_credential__");

    // Upload to Hetzner (public key not already there)
    mockHetznerCreateSshKey.mockResolvedValueOnce({ id: 88, name: "action-llama", fingerprint: "aa:bb", public_key: "ssh-ed25519 AL...", labels: {}, created: "2024-01-01" });

    setupSshMocks();

    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateSshKey).toHaveBeenCalledWith("fake-hetzner-key", "action-llama", "ssh-ed25519 AL...");
    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ssh_keys: [88],
    }));
    expect(result).toHaveProperty("sshKeyPath", "/mock-creds/vps_ssh/default/private_key");
  });

  it("reuses Hetzner key when AL credential public key already exists on Hetzner", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    const pubKey = "ssh-ed25519 EXISTING...";
    const hetznerKeys = [
      { id: 77, name: "mykey", fingerprint: "xx:yy", public_key: pubKey, labels: {}, created: "2024-01-01" },
    ];

    mockHetznerListServerTypes.mockResolvedValue(TEST_SERVER_TYPES);
    mockHetznerListLocations.mockResolvedValue(TEST_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(TEST_IMAGES);
    mockHetznerListSshKeys.mockResolvedValue(hetznerKeys);
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockCredentialExists.mockResolvedValue(true);
    mockLoadCredentialFields.mockResolvedValue({
      private_key: "PRIV_KEY",
      public_key: pubKey,
    });

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("__al_credential__");

    setupSshMocks();

    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    // Should NOT upload — key already on Hetzner
    expect(mockHetznerCreateSshKey).not.toHaveBeenCalled();
    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ssh_keys: [77],
    }));
  });

  it("filters to non-deprecated server types", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 1000000).toISOString();

    const serverTypesWithDeprecated = [
      ...TEST_SERVER_TYPES,
      {
        id: 3,
        name: "deprecated-type",
        description: "Old",
        cores: 1,
        memory: 1,
        disk: 10,
        architecture: "x86",
        deprecation: { announced: "2024-01-01", unavailable_after: past }, // past = deprecated
        prices: [{ location: "fsn1", price_hourly: { net: "0.00", gross: "0.00" }, price_monthly: { net: "2.00", gross: "2.50" } }],
        locations: [{ id: 1, name: "fsn1", deprecation: null }],
      },
    ];

    mockHetznerListServerTypes.mockResolvedValue(serverTypesWithDeprecated);
    mockHetznerListLocations.mockResolvedValue(TEST_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(TEST_IMAGES);
    mockHetznerListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // Capture the choices passed to search via the source function
    let typeChoices: any[] = [];
    mockSearch.mockImplementation(async (opts: any) => {
      if (opts.message === "Server Type:") {
        // searchWithEsc passes a `source` function — call it with undefined to get all choices
        typeChoices = opts.source ? opts.source(undefined) : [];
        return "cx22";
      }
      if (opts.message === "Location:") return "fsn1";
      if (opts.message === "SSH key:") return "1";
      return null;
    });

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    await setupVpsCloud();

    // "deprecated-type" should not appear in choices
    const choiceNames = typeChoices.map((c: any) => c.value);
    expect(choiceNames).not.toContain("deprecated-type");
    expect(choiceNames).toContain("cx22");
  });

  it("filters locations by server type availability", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    // cx32 is only available in fsn1 (not nbg1 or hel1)
    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);

    const serverForCx32 = { ...TEST_SERVER };
    mockHetznerCreateServer.mockResolvedValue(serverForCx32);
    mockHetznerGetServer.mockResolvedValue(serverForCx32);

    let locationChoices: any[] = [];
    mockSearch.mockImplementation(async (opts: any) => {
      if (opts.message === "Server Type:") return "cx32";
      if (opts.message === "Location:") {
        // searchWithEsc passes a `source` function — call it with undefined to get all choices
        locationChoices = opts.source ? opts.source(undefined) : [];
        return "fsn1";
      }
      if (opts.message === "SSH key:") return "1";
      return null;
    });

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    await setupVpsCloud();

    // cx32 only has fsn1 location
    const locationNames = locationChoices.map((c: any) => c.value);
    expect(locationNames).toContain("fsn1");
    expect(locationNames).not.toContain("nbg1"); // cx32 not available in nbg1
    expect(locationNames).not.toContain("hel1"); // cx32 not available in hel1
  });

  it("auto-selects ubuntu-22.04 OS image", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // OS should be auto-selected — search is only called for type, location, and SSH key
    mockSearch
      .mockResolvedValueOnce("cx22")   // server type
      .mockResolvedValueOnce("fsn1")   // location
      // NO search call for OS — it's auto-selected
      .mockResolvedValueOnce("1");     // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      image: "ubuntu-22.04",
    }));
    // Only 3 search calls (type, location, SSH key) — OS was auto-selected
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });

  it("prompts for OS when ubuntu-22.04 is not available", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    const imagesWithoutUbuntu2204 = TEST_IMAGES.filter((img) => img.name !== "ubuntu-22.04");
    mockHetznerListServerTypes.mockResolvedValue(TEST_SERVER_TYPES);
    mockHetznerListLocations.mockResolvedValue(TEST_LOCATIONS);
    mockHetznerListImages.mockResolvedValue(imagesWithoutUbuntu2204);
    mockHetznerListSshKeys.mockResolvedValue(TEST_SSH_KEYS);
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // Now search should be called for OS too
    mockSearch
      .mockResolvedValueOnce("cx22")       // server type
      .mockResolvedValueOnce("fsn1")       // location
      .mockResolvedValueOnce("debian-12")  // OS (prompted since ubuntu-22.04 missing)
      .mockResolvedValueOnce("1");         // SSH key

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      image: "debian-12",
    }));
    // 4 search calls: type, location, OS, SSH key
    expect(mockSearch).toHaveBeenCalledTimes(4);
  });

  it("returns null when server never becomes ready (timeout)", async () => {
    vi.useFakeTimers();

    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false); // Decline HTTPS

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);

    // Server is created but never becomes running
    const pendingServer = {
      ...TEST_SERVER,
      status: "starting",
      public_net: { ipv4: { ip: "0.0.0.0", blocked: false }, ipv6: { ip: "", blocked: false } },
    };
    mockHetznerCreateServer.mockResolvedValue(pendingServer);
    mockHetznerGetServer.mockResolvedValue(pendingServer);

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    // Run setupVpsCloud concurrently while advancing fake timers
    const resultPromise = setupVpsCloud();

    // Advance time past the 10-minute timeout
    for (let i = 0; i < 70; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    const result = await resultPromise;
    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("stays on SSH key step when promptCredential returns undefined (user cancels)", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    // First attempt: user picks __new__, then cancels, then picks existing key
    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("__new__")   // first attempt — cancel
      .mockResolvedValueOnce("1");        // second attempt — existing key

    mockPromptCredential.mockResolvedValueOnce(undefined); // cancel

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    const result = await setupVpsCloud();

    expect(result).not.toBeNull();
    expect(mockPromptCredential).toHaveBeenCalledTimes(1);
    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ssh_keys: [1],
    }));
  });

  it("passes envName to create server with custom name", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    setupSshMocks();
    mockConfirm.mockResolvedValueOnce(true);

    await setupVpsCloud(undefined, "prod");

    expect(mockHetznerCreateServer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: "action-llama-prod",
    }));
  });

  it("returns null when final SSH connection check fails after server is ready", async () => {
    mockSelect.mockResolvedValueOnce("hetzner");
    mockConfirm.mockResolvedValueOnce(false);

    setupHetznerCatalogMocks();
    setupHetznerFirewallMocks(true);
    setupHetznerServerMocks();

    mockSearch
      .mockResolvedValueOnce("cx22")
      .mockResolvedValueOnce("fsn1")
      .mockResolvedValueOnce("1");

    // SSH succeeds during polling (echo ok, node --version, docker info)
    // but fails on final check
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      callCount++;
      const command = args[args.length - 1];
      if (command.includes("echo ok")) {
        if (callCount <= 1) {
          // First echo ok (polling) succeeds
          cb(null, "ok\n", "");
        } else {
          // Final echo ok (final SSH check) fails
          cb(new Error("Connection refused"), "", "");
        }
      } else if (command.includes("node --version")) {
        cb(null, "v22.14.0\n", "");
      } else {
        cb(null, "24.0.7\n", "");
      }
    });

    const result = await setupVpsCloud();
    expect(result).toBeNull();
  });
});
