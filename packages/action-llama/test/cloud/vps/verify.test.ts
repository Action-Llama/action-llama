import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerConfig } from "../../../src/shared/server.js";

// Mock SSH module
vi.mock("../../../src/cloud/vps/ssh.js", () => ({
  testConnection: vi.fn(),
  sshExec: vi.fn(),
}));

// Mock Vultr API
vi.mock("../../../src/cloud/vps/vultr-api.js", () => ({
  listFirewallGroups: vi.fn(),
  listFirewallRules: vi.fn(),
  createFirewallRule: vi.fn(),
}));

// Mock Cloudflare API
vi.mock("../../../src/cloud/cloudflare/api.js", () => ({
  findDnsRecord: vi.fn(),
  upsertDnsRecord: vi.fn(),
  getSslMode: vi.fn(),
  setSslMode: vi.fn(),
}));

// Mock FilesystemBackend
const mockBackendInstance = { read: vi.fn() };
vi.mock("../../../src/shared/filesystem-backend.js", () => ({
  FilesystemBackend: class {
    read = mockBackendInstance.read;
  },
}));

import { verifyEnvironment } from "../../../src/cloud/vps/verify.js";
import { testConnection, sshExec } from "../../../src/cloud/vps/ssh.js";
import { listFirewallGroups, listFirewallRules, createFirewallRule } from "../../../src/cloud/vps/vultr-api.js";
import { findDnsRecord, upsertDnsRecord, getSslMode, setSslMode } from "../../../src/cloud/cloudflare/api.js";
const mockTestConnection = vi.mocked(testConnection);
const mockSshExec = vi.mocked(sshExec);
const mockListFirewallGroups = vi.mocked(listFirewallGroups);
const mockListFirewallRules = vi.mocked(listFirewallRules);
const mockCreateFirewallRule = vi.mocked(createFirewallRule);
const mockFindDnsRecord = vi.mocked(findDnsRecord);
const mockUpsertDnsRecord = vi.mocked(upsertDnsRecord);
const mockGetSslMode = vi.mocked(getSslMode);
const mockSetSslMode = vi.mocked(setSslMode);

function mockBackendRead(values: Record<string, string>) {
  mockBackendInstance.read.mockImplementation(
    (type: string, instance: string, field: string) =>
      Promise.resolve(values[`${type}/${instance}/${field}`] ?? undefined),
  );
}

function baseServer(): ServerConfig {
  return {
    host: "1.2.3.4",
    user: "root",
    port: 22,
    provider: "vps",
    vultrInstanceId: "inst-123",
    cloudflareHostname: "agents.example.com",
    cloudflareZoneId: "zone-1",
  };
}

function sshOk() {
  return { stdout: "ok", stderr: "", exitCode: 0 };
}

describe("verifyEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all pass when everything is healthy", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 4, max_rule_count: 50 }]);
    mockListFirewallRules.mockResolvedValue([
      { ip_type: "v4", protocol: "tcp", port: "22" },
      { ip_type: "v4", protocol: "tcp", port: "80" },
      { ip_type: "v4", protocol: "tcp", port: "443" },
    ]);
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    expect(results.every((r) => r.status === "pass" || r.status === "skip")).toBe(true);
    expect(results.find((r) => r.name === "SSH connectivity")?.status).toBe("pass");
    expect(results.find((r) => r.name === "Node.js")?.status).toBe("pass");
    expect(results.find((r) => r.name === "Docker")?.status).toBe("pass");
    expect(results.find((r) => r.name === "Vultr firewall")?.status).toBe("pass");
    expect(results.find((r) => r.name === "DNS")?.status).toBe("pass");
    expect(results.find((r) => r.name === "nginx")?.status).toBe("pass");
    expect(results.find((r) => r.name === "Cloudflare SSL")?.status).toBe("pass");
  });

  it("short-circuits on SSH failure with only 1 result", async () => {
    mockTestConnection.mockResolvedValue(false);

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("SSH connectivity");
    expect(results[0].status).toBe("fail");
  });

  it("reports missing firewall ports in check mode", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 2, max_rule_count: 50 }]);
    // Only SSH rule, missing 80 and 443
    mockListFirewallRules.mockResolvedValue([
      { ip_type: "v4", protocol: "tcp", port: "22" },
    ]);
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    const fw = results.find((r) => r.name === "Vultr firewall");
    expect(fw?.status).toBe("fail");
    expect(fw?.detail).toContain("80");
    expect(fw?.detail).toContain("443");
  });

  it("fixes missing firewall ports in fix mode", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 2, max_rule_count: 50 }]);
    mockListFirewallRules.mockResolvedValue([
      { ip_type: "v4", protocol: "tcp", port: "22" },
    ]);
    mockCreateFirewallRule.mockResolvedValue(undefined);
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "fix" });
    const fw = results.find((r) => r.name === "Vultr firewall");
    expect(fw?.status).toBe("fixed");
    // 2 missing ports × 2 IP types (v4 + v6) = 4 rule creation calls
    expect(mockCreateFirewallRule).toHaveBeenCalledTimes(4);
  });

  it("fixes DNS pointing at wrong IP in fix mode", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 6, max_rule_count: 50 }]);
    mockListFirewallRules.mockResolvedValue([
      { ip_type: "v4", protocol: "tcp", port: "22" },
      { ip_type: "v4", protocol: "tcp", port: "80" },
      { ip_type: "v4", protocol: "tcp", port: "443" },
    ]);
    // DNS points at old IP
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "9.9.9.9", proxied: true, ttl: 1 });
    mockUpsertDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "fix" });
    const dns = results.find((r) => r.name === "DNS");
    expect(dns?.status).toBe("fixed");
    expect(dns?.detail).toContain("9.9.9.9");
    expect(mockUpsertDnsRecord).toHaveBeenCalledWith("cf-token", "zone-1", "agents.example.com", "1.2.3.4", true);
  });

  it("skips credential-dependent checks with warn when credentials missing", async () => {
    mockBackendRead({}); // no credentials
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    const fw = results.find((r) => r.name === "Vultr firewall");
    expect(fw?.status).toBe("warn");
    const dns = results.find((r) => r.name === "DNS");
    expect(dns?.status).toBe("warn");
    const ssl = results.find((r) => r.name === "Cloudflare SSL");
    expect(ssl?.status).toBe("warn");
  });

  it("skips Cloudflare checks for non-Cloudflare env", async () => {
    mockBackendRead({});
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22 };
    const results = await verifyEnvironment({ server, mode: "check" });

    const names = results.map((r) => r.name);
    expect(names).toContain("SSH connectivity");
    expect(names).toContain("Node.js");
    expect(names).toContain("Docker");
    expect(names).toContain("Gateway");
    expect(names).not.toContain("Vultr firewall");
    expect(names).not.toContain("DNS");
    expect(names).not.toContain("nginx");
    expect(names).not.toContain("Cloudflare SSL");
  });

  it("fixes SSL mode in fix mode", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 6, max_rule_count: 50 }]);
    mockListFirewallRules.mockResolvedValue([
      { ip_type: "v4", protocol: "tcp", port: "22" },
      { ip_type: "v4", protocol: "tcp", port: "80" },
      { ip_type: "v4", protocol: "tcp", port: "443" },
    ]);
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("full");
    mockSetSslMode.mockResolvedValue(undefined);

    const results = await verifyEnvironment({ server: baseServer(), mode: "fix" });
    const ssl = results.find((r) => r.name === "Cloudflare SSL");
    expect(ssl?.status).toBe("fixed");
    expect(ssl?.detail).toContain("full");
    expect(ssl?.detail).toContain("strict");
    expect(mockSetSslMode).toHaveBeenCalledWith("cf-token", "zone-1", "strict");
  });

  it("reports Docker not installed", async () => {
    mockBackendRead({});
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "", stderr: "error", exitCode: 1 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22 };
    const results = await verifyEnvironment({ server, mode: "check" });
    const docker = results.find((r) => r.name === "Docker");
    expect(docker?.status).toBe("fail");
    expect(docker?.detail).toBe("not installed");
    expect(docker?.fixable).toBe(false);
  });

  it("fixes Node.js installation successfully in fix mode", async () => {
    mockBackendRead({});
    mockTestConnection.mockResolvedValue(true);
    // First call (node --version): not installed; second call (node --version after install): success
    let nodeCallCount = 0;
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") {
        nodeCallCount++;
        if (nodeCallCount === 1) return Promise.resolve({ stdout: "", stderr: "not found", exitCode: 1 });
        return Promise.resolve({ stdout: "v22.0.0", stderr: "", exitCode: 0 });
      }
      if (cmd.includes("nodesource")) return Promise.resolve({ stdout: "done", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.0.0", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22 };
    const results = await verifyEnvironment({ server, mode: "fix" });
    const node = results.find((r) => r.name === "Node.js");
    expect(node?.status).toBe("fixed");
    expect(node?.detail).toContain("v22.0.0");
  });

  it("reports Node.js installation failed when install command fails in fix mode", async () => {
    mockBackendRead({});
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "", stderr: "not found", exitCode: 1 });
      if (cmd.includes("nodesource")) return Promise.resolve({ stdout: "", stderr: "install failed", exitCode: 1 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.0.0", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22 };
    const results = await verifyEnvironment({ server, mode: "fix" });
    const node = results.find((r) => r.name === "Node.js");
    expect(node?.status).toBe("fail");
    expect(node?.detail).toBe("installation failed");
  });

  it("returns warn when listFirewallGroups API throws", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockRejectedValue(new Error("network timeout"));
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    const fw = results.find((r) => r.name === "Vultr firewall");
    expect(fw?.status).toBe("warn");
    expect(fw?.detail).toContain("network timeout");
  });

  it("returns warn when listFirewallRules API throws", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 0, max_rule_count: 50 }]);
    mockListFirewallRules.mockRejectedValue(new Error("rules API down"));
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    const fw = results.find((r) => r.name === "Vultr firewall");
    expect(fw?.status).toBe("warn");
    expect(fw?.detail).toContain("rules API down");
  });

  it("returns warn when no action-llama firewall group exists", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    // Return groups with no "action-llama" description
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "other-group", date_created: "", date_modified: "", instance_count: 0, rule_count: 0, max_rule_count: 50 }]);
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    const fw = results.find((r) => r.name === "Vultr firewall");
    expect(fw?.status).toBe("warn");
    expect(fw?.detail).toContain("no 'action-llama' firewall group found");
  });

  it("reports DNS fail with 'no record' when no DNS record exists in check mode", async () => {
    mockBackendRead({
      "vultr_api_key/default/api_key": "vultr-key",
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("systemctl is-active")) return Promise.resolve({ stdout: "active", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockListFirewallGroups.mockResolvedValue([{ id: "fw-1", description: "action-llama", date_created: "", date_modified: "", instance_count: 1, rule_count: 6, max_rule_count: 50 }]);
    mockListFirewallRules.mockResolvedValue([
      { ip_type: "v4", protocol: "tcp", port: "22" },
      { ip_type: "v4", protocol: "tcp", port: "80" },
      { ip_type: "v4", protocol: "tcp", port: "443" },
    ]);
    // No DNS record exists
    mockFindDnsRecord.mockResolvedValue(null);
    mockGetSslMode.mockResolvedValue("strict");

    const results = await verifyEnvironment({ server: baseServer(), mode: "check" });
    const dns = results.find((r) => r.name === "DNS");
    expect(dns?.status).toBe("fail");
    expect(dns?.detail).toContain("no record");
    expect(dns?.detail).toContain("1.2.3.4");
  });

  it("restarts nginx successfully in fix mode when nginx is inactive", async () => {
    mockBackendRead({
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd === "systemctl is-active nginx") return Promise.resolve({ stdout: "inactive", stderr: "", exitCode: 1 });
      if (cmd === "systemctl restart nginx") return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22, cloudflareHostname: "agents.example.com", cloudflareZoneId: "zone-1" };
    const results = await verifyEnvironment({ server, mode: "fix" });
    const nginx = results.find((r) => r.name === "nginx");
    expect(nginx?.status).toBe("fixed");
    expect(nginx?.detail).toBe("restarted");
  });

  it("reports nginx restart failed in fix mode when restart command fails", async () => {
    mockBackendRead({
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd === "systemctl is-active nginx") return Promise.resolve({ stdout: "failed", stderr: "", exitCode: 1 });
      if (cmd === "systemctl restart nginx") return Promise.resolve({ stdout: "", stderr: "restart failed", exitCode: 1 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22, cloudflareHostname: "agents.example.com", cloudflareZoneId: "zone-1" };
    const results = await verifyEnvironment({ server, mode: "fix" });
    const nginx = results.find((r) => r.name === "nginx");
    expect(nginx?.status).toBe("fail");
    expect(nginx?.detail).toBe("restart failed");
  });

  it("reports nginx not running in check mode when nginx is inactive", async () => {
    mockBackendRead({
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd === "systemctl is-active nginx") return Promise.resolve({ stdout: "inactive", stderr: "", exitCode: 1 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockFindDnsRecord.mockResolvedValue({ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 });
    mockGetSslMode.mockResolvedValue("strict");

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22, cloudflareHostname: "agents.example.com", cloudflareZoneId: "zone-1" };
    const results = await verifyEnvironment({ server, mode: "check" });
    const nginx = results.find((r) => r.name === "nginx");
    expect(nginx?.status).toBe("fail");
    expect(nginx?.detail).toBe("inactive");
  });

  it("reports SSL mode fail in check mode when SSL mode is not strict", async () => {
    mockBackendRead({
      "cloudflare_api_token/default/api_token": "cf-token",
    });
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      if (cmd.includes("curl")) return Promise.resolve(sshOk());
      return Promise.resolve(sshOk());
    });
    mockGetSslMode.mockResolvedValue("flexible");

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22, cloudflareZoneId: "zone-1" };
    const results = await verifyEnvironment({ server, mode: "check" });
    const ssl = results.find((r) => r.name === "Cloudflare SSL");
    expect(ssl?.status).toBe("fail");
    expect(ssl?.detail).toContain("flexible");
    expect(ssl?.detail).toContain("strict");
  });

  it("reports gateway skip when curl health check fails", async () => {
    mockBackendRead({});
    mockTestConnection.mockResolvedValue(true);
    mockSshExec.mockImplementation((_cfg, cmd) => {
      if (cmd === "node --version") return Promise.resolve({ stdout: "v22.22.1", stderr: "", exitCode: 0 });
      if (cmd.includes("docker info")) return Promise.resolve({ stdout: "29.3.0", stderr: "", exitCode: 0 });
      // gateway health check fails
      if (cmd.includes("curl")) return Promise.resolve({ stdout: "", stderr: "connection refused", exitCode: 1 });
      return Promise.resolve(sshOk());
    });

    const server: ServerConfig = { host: "1.2.3.4", user: "root", port: 22 };
    const results = await verifyEnvironment({ server, mode: "check" });
    const gw = results.find((r) => r.name === "Gateway");
    expect(gw?.status).toBe("skip");
    expect(gw?.detail).toContain("al push");
  });
});
