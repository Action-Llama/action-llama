import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ssh helper
const { mockSshExec } = vi.hoisted(() => ({
  mockSshExec: vi.fn(),
}));

vi.mock("../../../src/cloud/vps/ssh.js", () => ({
  sshExec: (...args: any[]) => mockSshExec(...args),
}));

// Mock FilesystemBackend
const { mockBackendRead } = vi.hoisted(() => ({
  mockBackendRead: vi.fn(),
}));

vi.mock("../../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = mockBackendRead;
  },
}));

// Mock cloudflare api (dynamic import)
const { mockDeleteDnsRecord } = vi.hoisted(() => ({
  mockDeleteDnsRecord: vi.fn(),
}));

vi.mock("../../../src/cloud/cloudflare/api.js", () => ({
  deleteDnsRecord: (...args: any[]) => mockDeleteDnsRecord(...args),
}));

// Mock vultr-api (dynamic import)
const {
  mockDeleteInstance,
  mockListFirewallGroups,
  mockGetFirewallGroup,
  mockDeleteFirewallGroup,
} = vi.hoisted(() => ({
  mockDeleteInstance: vi.fn(),
  mockListFirewallGroups: vi.fn(),
  mockGetFirewallGroup: vi.fn(),
  mockDeleteFirewallGroup: vi.fn(),
}));

vi.mock("../../../src/cloud/vps/vultr-api.js", () => ({
  deleteInstance: (...args: any[]) => mockDeleteInstance(...args),
  listFirewallGroups: (...args: any[]) => mockListFirewallGroups(...args),
  getFirewallGroup: (...args: any[]) => mockGetFirewallGroup(...args),
  deleteFirewallGroup: (...args: any[]) => mockDeleteFirewallGroup(...args),
}));

// Mock hetzner-api (dynamic import)
const {
  mockDeleteServer,
  mockListFirewalls,
  mockGetFirewall,
  mockDeleteFirewall,
} = vi.hoisted(() => ({
  mockDeleteServer: vi.fn(),
  mockListFirewalls: vi.fn(),
  mockGetFirewall: vi.fn(),
  mockDeleteFirewall: vi.fn(),
}));

vi.mock("../../../src/cloud/vps/hetzner-api.js", () => ({
  deleteServer: (...args: any[]) => mockDeleteServer(...args),
  listFirewalls: (...args: any[]) => mockListFirewalls(...args),
  getFirewall: (...args: any[]) => mockGetFirewall(...args),
  deleteFirewall: (...args: any[]) => mockDeleteFirewall(...args),
}));

const { teardownVps } = await import("../../../src/cloud/vps/teardown.js");

const BASE_VPS_CONFIG = {
  host: "1.2.3.4",
  sshUser: "root",
  sshPort: 22,
  sshKeyPath: "/home/test/.ssh/id_rsa",
};

describe("teardownVps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: ssh exec succeeds but no containers
    mockSshExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockBackendRead.mockResolvedValue(undefined);
  });

  describe("container cleanup", () => {
    it("stops and removes containers when found", async () => {
      mockSshExec
        .mockResolvedValueOnce({ exitCode: 0, stdout: "container-id-1\ncontainer-id-2\n", stderr: "" }) // list containers
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // remove containers

      await teardownVps("/project", BASE_VPS_CONFIG);

      expect(mockSshExec).toHaveBeenCalledWith(
        expect.objectContaining({ host: "1.2.3.4" }),
        "docker ps -aq --filter 'name=al-'",
        15_000
      );
      expect(mockSshExec).toHaveBeenCalledWith(
        expect.objectContaining({ host: "1.2.3.4" }),
        "docker ps -aq --filter 'name=al-' | xargs -r docker rm -f",
        30_000
      );
    });

    it("skips container removal when list is empty", async () => {
      // When no containers found, the xargs remove command should NOT be called
      await teardownVps("/project", BASE_VPS_CONFIG);

      const removeCalls = mockSshExec.mock.calls.filter(
        (c: any[]) => typeof c[1] === "string" && c[1].includes("xargs")
      );
      expect(removeCalls).toHaveLength(0);
    });

    it("skips container removal when list command fails", async () => {
      mockSshExec.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "error" }); // list fails

      await teardownVps("/project", BASE_VPS_CONFIG);

      // The xargs remove command should NOT be called
      const removeCalls = mockSshExec.mock.calls.filter(
        (c: any[]) => typeof c[1] === "string" && c[1].includes("xargs")
      );
      expect(removeCalls).toHaveLength(0);
    });

    it("continues if SSH throws during container cleanup", async () => {
      mockSshExec.mockRejectedValueOnce(new Error("Connection refused"));

      await expect(teardownVps("/project", BASE_VPS_CONFIG)).resolves.not.toThrow();
    });

    it("logs container removal when containers are found", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockSshExec
        .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

      await teardownVps("/project", BASE_VPS_CONFIG);

      expect(consoleSpy).toHaveBeenCalledWith("Stopping Action Llama containers on VPS...");
      expect(consoleSpy).toHaveBeenCalledWith("Containers removed.");
      consoleSpy.mockRestore();
    });
  });

  describe("credential cleanup", () => {
    it("removes remote credentials directory when it exists", async () => {
      mockSshExec
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // container list (empty)
        .mockResolvedValueOnce({ exitCode: 0, stdout: "exists", stderr: "" }) // check credentials dir
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // rm credentials

      await teardownVps("/project", BASE_VPS_CONFIG);

      expect(mockSshExec).toHaveBeenCalledWith(
        expect.objectContaining({ host: "1.2.3.4" }),
        expect.stringContaining("rm -rf")
      );
    });

    it("skips credential removal when directory does not exist", async () => {
      mockSshExec
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // container list (empty)
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // check credentials dir returns nothing

      await teardownVps("/project", BASE_VPS_CONFIG);

      // Should only have the list call and the credentials check
      expect(mockSshExec).toHaveBeenCalledTimes(2);
    });

    it("continues if SSH throws during credential cleanup", async () => {
      mockSshExec
        .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // container list (empty)
        .mockRejectedValueOnce(new Error("Connection lost")); // creds check fails

      await expect(teardownVps("/project", BASE_VPS_CONFIG)).resolves.not.toThrow();
    });
  });

  describe("cloudflare DNS cleanup", () => {
    const vpsConfigWithCF = {
      ...BASE_VPS_CONFIG,
      cloudflareZoneId: "zone-123",
      cloudflareDnsRecordId: "dns-456",
      cloudflareHostname: "agent.example.com",
    };

    it("deletes DNS record when cloudflare is configured and token is available", async () => {
      mockBackendRead.mockResolvedValue("cf-api-token");
      mockDeleteDnsRecord.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithCF);

      expect(mockDeleteDnsRecord).toHaveBeenCalledWith("cf-api-token", "zone-123", "dns-456");
    });

    it("logs successful DNS deletion with hostname", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue("cf-api-token");
      mockDeleteDnsRecord.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithCF);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("agent.example.com")
      );
      consoleSpy.mockRestore();
    });

    it("logs message when cloudflare token not found", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithCF);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cloudflare API token not found")
      );
      expect(mockDeleteDnsRecord).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("logs error message when DNS deletion fails", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue("cf-api-token");
      mockDeleteDnsRecord.mockRejectedValue(new Error("API rate limited"));

      await teardownVps("/project", vpsConfigWithCF);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cloudflare DNS cleanup failed")
      );
      consoleSpy.mockRestore();
    });

    it("skips cloudflare cleanup when zone/record IDs are missing", async () => {
      await teardownVps("/project", BASE_VPS_CONFIG);

      expect(mockDeleteDnsRecord).not.toHaveBeenCalled();
      expect(mockBackendRead).not.toHaveBeenCalledWith("cloudflare_api_token", expect.anything(), expect.anything());
    });
  });

  describe("vultr instance deletion", () => {
    const vpsConfigWithVultr = {
      ...BASE_VPS_CONFIG,
      vultrInstanceId: "inst-789",
    };

    it("deletes vultr instance when vultrInstanceId is configured and API key available", async () => {
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockResolvedValue([]);

      await teardownVps("/project", vpsConfigWithVultr);

      expect(mockDeleteInstance).toHaveBeenCalledWith("vultr-api-key", "inst-789");
    });

    it("logs message when vultr API key not found", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithVultr);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Vultr API key not found")
      );
      expect(mockDeleteInstance).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("logs success after deleting vultr instance", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockResolvedValue([]);

      await teardownVps("/project", vpsConfigWithVultr);

      expect(consoleSpy).toHaveBeenCalledWith("Vultr instance deleted.");
      consoleSpy.mockRestore();
    });

    it("cleans up firewall group when no instances remain after deletion", async () => {
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockResolvedValue([
        { id: "fw-1", description: "action-llama", instance_count: 1 },
      ]);
      mockGetFirewallGroup.mockResolvedValue({ id: "fw-1", instance_count: 0 });
      mockDeleteFirewallGroup.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithVultr);

      expect(mockDeleteFirewallGroup).toHaveBeenCalledWith("vultr-api-key", "fw-1");
    });

    it("does not delete firewall group when instances remain", async () => {
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockResolvedValue([
        { id: "fw-1", description: "action-llama", instance_count: 2 },
      ]);
      mockGetFirewallGroup.mockResolvedValue({ id: "fw-1", instance_count: 2 });

      await teardownVps("/project", vpsConfigWithVultr);

      expect(mockDeleteFirewallGroup).not.toHaveBeenCalled();
    });

    it("continues if firewall cleanup fails", async () => {
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockRejectedValue(new Error("API error"));

      await expect(teardownVps("/project", vpsConfigWithVultr)).resolves.not.toThrow();
    });

    it("skips firewall cleanup when no action-llama group found", async () => {
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockResolvedValue([
        { id: "fw-other", description: "other-group", instance_count: 0 },
      ]);

      await teardownVps("/project", vpsConfigWithVultr);

      expect(mockGetFirewallGroup).not.toHaveBeenCalled();
      expect(mockDeleteFirewallGroup).not.toHaveBeenCalled();
    });

    it("logs firewall group deletion", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue("vultr-api-key");
      mockDeleteInstance.mockResolvedValue(undefined);
      mockListFirewallGroups.mockResolvedValue([
        { id: "fw-1", description: "action-llama", instance_count: 1 },
      ]);
      mockGetFirewallGroup.mockResolvedValue({ id: "fw-1", instance_count: 0 });
      mockDeleteFirewallGroup.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithVultr);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Vultr firewall group deleted (no remaining instances)."
      );
      consoleSpy.mockRestore();
    });
  });

  describe("hetzner instance deletion", () => {
    const vpsConfigWithHetzner = {
      ...BASE_VPS_CONFIG,
      hetznerServerId: 42,
    };

    it("deletes hetzner server when hetznerServerId is configured and API key available", async () => {
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockResolvedValue([]);

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(mockDeleteServer).toHaveBeenCalledWith("hetzner-api-key", 42);
    });

    it("logs message when hetzner API key not found", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Hetzner API key not found")
      );
      expect(mockDeleteServer).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("logs success after deleting hetzner server", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockResolvedValue([]);

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(consoleSpy).toHaveBeenCalledWith("Hetzner server deleted.");
      consoleSpy.mockRestore();
    });

    it("cleans up hetzner firewall when no servers remain after deletion", async () => {
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockResolvedValue([
        { id: 10, name: "action-llama", applied_to: [{ server: { id: 1 } }] },
      ]);
      mockGetFirewall.mockResolvedValue({ id: 10, name: "action-llama", applied_to: [] });
      mockDeleteFirewall.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(mockDeleteFirewall).toHaveBeenCalledWith("hetzner-api-key", 10);
    });

    it("does not delete hetzner firewall when servers remain", async () => {
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockResolvedValue([
        { id: 10, name: "action-llama", applied_to: [{ server: { id: 1 } }] },
      ]);
      mockGetFirewall.mockResolvedValue({
        id: 10,
        name: "action-llama",
        applied_to: [{ server: { id: 2 } }],
      });

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(mockDeleteFirewall).not.toHaveBeenCalled();
    });

    it("continues if hetzner firewall cleanup fails", async () => {
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockRejectedValue(new Error("API error"));

      await expect(teardownVps("/project", vpsConfigWithHetzner)).resolves.not.toThrow();
    });

    it("skips hetzner firewall cleanup when no action-llama firewall found", async () => {
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockResolvedValue([
        { id: 10, name: "other-firewall", applied_to: [] },
      ]);

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(mockGetFirewall).not.toHaveBeenCalled();
      expect(mockDeleteFirewall).not.toHaveBeenCalled();
    });

    it("logs hetzner firewall deletion", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      mockBackendRead.mockResolvedValue("hetzner-api-key");
      mockDeleteServer.mockResolvedValue(undefined);
      mockListFirewalls.mockResolvedValue([
        { id: 10, name: "action-llama", applied_to: [{ server: { id: 1 } }] },
      ]);
      mockGetFirewall.mockResolvedValue({ id: 10, name: "action-llama", applied_to: [] });
      mockDeleteFirewall.mockResolvedValue(undefined);

      await teardownVps("/project", vpsConfigWithHetzner);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Hetzner firewall deleted (no remaining servers)."
      );
      consoleSpy.mockRestore();
    });
  });

  describe("SSH config defaults", () => {
    it("uses default SSH user, port, and key path when not specified", async () => {
      const minimalConfig = { host: "9.9.9.9" };

      await teardownVps("/project", minimalConfig);

      // The first SSH call should use defaults
      expect(mockSshExec).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "9.9.9.9",
          user: "root",
          port: 22,
          keyPath: "~/.ssh/id_rsa",
        }),
        expect.any(String),
        expect.anything()
      );
    });

    it("uses custom SSH config when provided", async () => {
      const customConfig = {
        host: "5.6.7.8",
        sshUser: "ubuntu",
        sshPort: 2222,
        sshKeyPath: "/custom/key",
      };

      await teardownVps("/project", customConfig);

      expect(mockSshExec).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "5.6.7.8",
          user: "ubuntu",
          port: 2222,
          keyPath: "/custom/key",
        }),
        expect.any(String),
        expect.anything()
      );
    });
  });
});
