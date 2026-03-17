/**
 * Vultr REST API v2 client.
 * Plain fetch() wrapper — no SDK dependency.
 */

const BASE_URL = "https://api.vultr.com/v2";

export interface VultrRegion {
  id: string;
  city: string;
  country: string;
  continent: string;
  options: string[];
}

export interface VultrPlan {
  id: string;
  vcpu_count: number;
  ram: number; // MB
  disk: number; // GB
  bandwidth: number; // TB
  monthly_cost: number;
  type: string;
  locations: string[];
}

export interface VultrOs {
  id: number;
  name: string;
  arch: string;
  family: string;
}

export interface VultrSshKey {
  id: string;
  name: string;
  ssh_key: string;
  date_created: string;
}

export interface VultrInstance {
  id: string;
  os: string;
  ram: number;
  disk: number;
  main_ip: string;
  vcpu_count: number;
  region: string;
  plan: string;
  status: string;
  power_status: string;
  server_status: string;
  label: string;
  date_created: string;
}

class VultrApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "VultrApiError";
  }
}

async function vultrFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VultrApiError(res.status, `Vultr API ${path} failed (HTTP ${res.status}): ${body}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return undefined;
  return res.json();
}

export async function listRegions(apiKey: string): Promise<VultrRegion[]> {
  const data = await vultrFetch(apiKey, "/regions");
  return data.regions;
}

export async function listPlans(apiKey: string): Promise<VultrPlan[]> {
  const data = await vultrFetch(apiKey, "/plans");
  return data.plans;
}

export async function listOsImages(apiKey: string): Promise<VultrOs[]> {
  const data = await vultrFetch(apiKey, "/os");
  return data.os;
}

export async function listSshKeys(apiKey: string): Promise<VultrSshKey[]> {
  const data = await vultrFetch(apiKey, "/ssh-keys");
  return data.ssh_keys;
}

export async function createSshKey(apiKey: string, name: string, sshKey: string): Promise<VultrSshKey> {
  const data = await vultrFetch(apiKey, "/ssh-keys", {
    method: "POST",
    body: JSON.stringify({ name, ssh_key: sshKey }),
  });
  return data.ssh_key;
}

export async function createInstance(
  apiKey: string,
  opts: {
    region: string;
    plan: string;
    os_id: number;
    sshkey_id: string[];
    label: string;
    user_data?: string; // base64 cloud-init script
  },
): Promise<VultrInstance> {
  const data = await vultrFetch(apiKey, "/instances", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  return data.instance;
}

export async function getInstance(apiKey: string, instanceId: string): Promise<VultrInstance> {
  const data = await vultrFetch(apiKey, `/instances/${instanceId}`);
  return data.instance;
}

export async function deleteInstance(apiKey: string, instanceId: string): Promise<void> {
  await vultrFetch(apiKey, `/instances/${instanceId}`, { method: "DELETE" });
}
