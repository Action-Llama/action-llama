/**
 * Environment verification and auto-fix.
 * Used by `al env check` (report-only) and `al env prov` re-runs (auto-fix).
 */

import type { ServerConfig } from "../../shared/server.js";
import type { SshConfig } from "./ssh.js";
import { VPS_CONSTANTS } from "./constants.js";
import { FilesystemBackend } from "../../shared/filesystem-backend.js";

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn" | "fixed" | "skip";
  detail?: string;
  fixable: boolean;
}

export interface VerifyOptions {
  server: ServerConfig;
  mode: "check" | "fix";
}

function sshConfigFrom(server: ServerConfig): SshConfig {
  return {
    host: server.host,
    user: server.user ?? VPS_CONSTANTS.DEFAULT_SSH_USER,
    port: server.port ?? VPS_CONSTANTS.DEFAULT_SSH_PORT,
    keyPath: server.keyPath ?? VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH,
  };
}

async function checkSsh(ssh: SshConfig): Promise<CheckResult> {
  const { testConnection } = await import("./ssh.js");
  const ok = await testConnection(ssh);
  return {
    name: "SSH connectivity",
    status: ok ? "pass" : "fail",
    detail: ok ? `${ssh.user}@${ssh.host}:${ssh.port}` : `cannot reach ${ssh.user}@${ssh.host}:${ssh.port}`,
    fixable: false,
  };
}

async function checkNode(ssh: SshConfig, mode: "check" | "fix"): Promise<CheckResult> {
  const { sshExec } = await import("./ssh.js");
  const result = await sshExec(ssh, "node --version");
  if (result.exitCode === 0) {
    return { name: "Node.js", status: "pass", detail: result.stdout.trim(), fixable: false };
  }

  if (mode === "fix") {
    const install = await sshExec(
      ssh,
      "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs",
      120_000,
    );
    if (install.exitCode === 0) {
      const ver = await sshExec(ssh, "node --version");
      return { name: "Node.js", status: "fixed", detail: `installed ${ver.stdout.trim()}`, fixable: true };
    }
    return { name: "Node.js", status: "fail", detail: "installation failed", fixable: true };
  }

  return { name: "Node.js", status: "fail", detail: "not installed", fixable: true };
}

async function checkDocker(ssh: SshConfig): Promise<CheckResult> {
  const { sshExec } = await import("./ssh.js");
  const result = await sshExec(ssh, "docker info --format '{{.ServerVersion}}'");
  if (result.exitCode === 0) {
    return { name: "Docker", status: "pass", detail: result.stdout.trim(), fixable: false };
  }
  return { name: "Docker", status: "fail", detail: "not installed", fixable: false };
}

async function checkVultrFirewall(
  server: ServerConfig,
  mode: "check" | "fix",
): Promise<CheckResult> {
  const backend = new FilesystemBackend();
  const apiKey = await backend.read("vultr_api_key", "default", "api_key");
  if (!apiKey) {
    return { name: "Vultr firewall", status: "warn", detail: "no Vultr API key credential", fixable: false };
  }

  const { listFirewallGroups, listFirewallRules, createFirewallRule } = await import("./vultr-api.js");

  let groups;
  try {
    groups = await listFirewallGroups(apiKey);
  } catch (err: any) {
    return { name: "Vultr firewall", status: "warn", detail: `API error: ${err.message}`, fixable: false };
  }

  const group = groups.find((g) => g.description === "action-llama");
  if (!group) {
    return { name: "Vultr firewall", status: "warn", detail: "no 'action-llama' firewall group found", fixable: false };
  }

  let rules;
  try {
    rules = await listFirewallRules(apiKey, group.id);
  } catch (err: any) {
    return { name: "Vultr firewall", status: "warn", detail: `API error: ${err.message}`, fixable: false };
  }

  // Determine required ports based on whether Cloudflare HTTPS is configured
  const hasHttps = !!server.cloudflareHostname;
  const requiredPorts = hasHttps
    ? ["22", "80", "443"]
    : ["22", String(server.gatewayPort ?? VPS_CONSTANTS.DEFAULT_GATEWAY_PORT)];

  // Check which ports have IPv4 TCP rules
  const coveredPorts = new Set(
    rules
      .filter((r: any) => r.ip_type === "v4" && r.protocol === "tcp")
      .map((r: any) => r.port),
  );

  const missingPorts = requiredPorts.filter((p) => !coveredPorts.has(p));
  if (missingPorts.length === 0) {
    return { name: "Vultr firewall", status: "pass", detail: `ports ${requiredPorts.join(", ")} open`, fixable: true };
  }

  if (mode === "fix") {
    const newRules = missingPorts.flatMap((port) => [
      { ip_type: "v4" as const, protocol: "tcp" as const, subnet: "0.0.0.0", subnet_size: 0, port, notes: `port ${port}` },
      { ip_type: "v6" as const, protocol: "tcp" as const, subnet: "::", subnet_size: 0, port, notes: `port ${port} IPv6` },
    ]);
    await Promise.all(newRules.map((r) => createFirewallRule(apiKey, group.id, r)));
    return { name: "Vultr firewall", status: "fixed", detail: `added ports ${missingPorts.join(", ")}`, fixable: true };
  }

  return { name: "Vultr firewall", status: "fail", detail: `missing ports ${missingPorts.join(", ")}`, fixable: true };
}

async function checkDns(
  server: ServerConfig,
  mode: "check" | "fix",
): Promise<CheckResult> {
  const backend = new FilesystemBackend();
  const cfToken = await backend.read("cloudflare_api_token", "default", "api_token");
  if (!cfToken) {
    return { name: "DNS", status: "warn", detail: "no Cloudflare API token credential", fixable: false };
  }

  const { findDnsRecord, upsertDnsRecord } = await import("./cloudflare-api.js");
  const hostname = server.cloudflareHostname!;
  const zoneId = server.cloudflareZoneId!;

  const record = await findDnsRecord(cfToken, zoneId, hostname);
  if (record && record.content === server.host) {
    return { name: "DNS", status: "pass", detail: `${hostname} → ${server.host}`, fixable: true };
  }

  const wrongIp = record ? record.content : "no record";

  if (mode === "fix") {
    await upsertDnsRecord(cfToken, zoneId, hostname, server.host, true);
    return { name: "DNS", status: "fixed", detail: `${hostname} → ${server.host} (was ${wrongIp})`, fixable: true };
  }

  return { name: "DNS", status: "fail", detail: `${hostname} → ${wrongIp} (expected ${server.host})`, fixable: true };
}

async function checkNginx(
  ssh: SshConfig,
  mode: "check" | "fix",
): Promise<CheckResult> {
  const { sshExec } = await import("./ssh.js");
  const result = await sshExec(ssh, "systemctl is-active nginx");
  if (result.stdout.trim() === "active") {
    return { name: "nginx", status: "pass", detail: "running", fixable: true };
  }

  if (mode === "fix") {
    const restart = await sshExec(ssh, "systemctl restart nginx");
    if (restart.exitCode === 0) {
      return { name: "nginx", status: "fixed", detail: "restarted", fixable: true };
    }
    return { name: "nginx", status: "fail", detail: "restart failed", fixable: true };
  }

  return { name: "nginx", status: "fail", detail: result.stdout.trim() || "not running", fixable: true };
}

async function checkSslMode(
  server: ServerConfig,
  mode: "check" | "fix",
): Promise<CheckResult> {
  const backend = new FilesystemBackend();
  const cfToken = await backend.read("cloudflare_api_token", "default", "api_token");
  if (!cfToken) {
    return { name: "Cloudflare SSL", status: "warn", detail: "no Cloudflare API token credential", fixable: false };
  }

  const { getSslMode, setSslMode } = await import("./cloudflare-api.js");
  const zoneId = server.cloudflareZoneId!;
  const current = await getSslMode(cfToken, zoneId);

  if (current === "strict") {
    return { name: "Cloudflare SSL", status: "pass", detail: "strict", fixable: true };
  }

  if (mode === "fix") {
    await setSslMode(cfToken, zoneId, "strict");
    return { name: "Cloudflare SSL", status: "fixed", detail: `${current} → strict`, fixable: true };
  }

  return { name: "Cloudflare SSL", status: "fail", detail: `"${current}" (expected "strict")`, fixable: true };
}

async function checkGateway(ssh: SshConfig, server: ServerConfig): Promise<CheckResult> {
  const { sshExec } = await import("./ssh.js");
  const port = server.gatewayPort ?? VPS_CONSTANTS.DEFAULT_GATEWAY_PORT;
  const result = await sshExec(ssh, `curl -sf http://localhost:${port}/health`, 10_000);
  if (result.exitCode === 0) {
    return { name: "Gateway", status: "pass", detail: "healthy", fixable: false };
  }
  return {
    name: "Gateway",
    status: "skip",
    detail: "not reachable (run 'al push' to deploy)",
    fixable: false,
  };
}

export async function verifyEnvironment(opts: VerifyOptions): Promise<CheckResult[]> {
  const { server, mode } = opts;
  const ssh = sshConfigFrom(server);
  const results: CheckResult[] = [];

  // 1. SSH (gate for everything else)
  const sshResult = await checkSsh(ssh);
  results.push(sshResult);
  if (sshResult.status === "fail") return results;

  // 2. Node.js
  results.push(await checkNode(ssh, mode));

  // 3. Docker
  results.push(await checkDocker(ssh));

  // 4. Vultr firewall (skip if no vultrInstanceId)
  if (server.vultrInstanceId) {
    results.push(await checkVultrFirewall(server, mode));
  }

  // 5. DNS (skip if no cloudflareHostname)
  if (server.cloudflareHostname && server.cloudflareZoneId) {
    results.push(await checkDns(server, mode));
  }

  // 6. nginx (skip if no cloudflareHostname)
  if (server.cloudflareHostname) {
    results.push(await checkNginx(ssh, mode));
  }

  // 7. SSL mode (skip if no cloudflareZoneId)
  if (server.cloudflareZoneId) {
    results.push(await checkSslMode(server, mode));
  }

  // 8. Gateway health
  results.push(await checkGateway(ssh, server));

  return results;
}
