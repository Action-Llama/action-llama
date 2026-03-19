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
});
