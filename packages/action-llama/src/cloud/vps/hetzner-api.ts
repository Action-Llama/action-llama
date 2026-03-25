/**
 * Hetzner Cloud API v1 client.
 * Plain fetch() wrapper — no SDK dependency.
 */

const BASE_URL = "https://api.hetzner.cloud/v1";

export interface HetznerLocation {
  id: number;
  name: string;
  description: string;
  country: string;
  city: string;
  latitude: number;
  longitude: number;
  network_zone: string;
}

export interface HetznerDeprecation {
  announced: string;
  unavailable_after: string;
}

export interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number; // GB
  disk: number; // GB
  architecture: string;
  deprecation: HetznerDeprecation | null;
  prices: Array<{
    location: string;
    price_hourly: {
      net: string;
      gross: string;
    };
    price_monthly: {
      net: string;
      gross: string;
    };
  }>;
  /** Available locations with per-location deprecation status. */
  locations: Array<{
    id: number;
    name: string;
    deprecation: HetznerDeprecation | null;
  }>;
}

export interface HetznerImage {
  id: number;
  type: string;
  status: string;
  name: string;
  description: string;
  os_flavor: string;
  os_version: string;
  architecture: string;
  deprecated: string | null;
}

export interface HetznerSshKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
  labels: Record<string, string>;
  created: string;
}

export interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4: {
      ip: string;
      blocked: boolean;
    };
    ipv6: {
      ip: string;
      blocked: boolean;
    };
  };
  server_type: {
    id: number;
    name: string;
    cores: number;
    memory: number;
    disk: number;
  };
  datacenter: {
    id: number;
    name: string;
    location: {
      id: number;
      name: string;
      country: string;
      city: string;
    };
  };
  created: string;
}

export interface HetznerFirewall {
  id: number;
  name: string;
  labels: Record<string, string>;
  rules: Array<{
    direction: "in" | "out";
    port?: string;
    protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
    source_ips: string[];
    destination_ips?: string[];
    description?: string;
  }>;
  applied_to: Array<{
    type: string;
    server?: number;
  }>;
  created: string;
}

class HetznerApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HetznerApiError";
  }
}

async function hetznerFetch(
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
    const body = await res.json().catch(() => ({ error: { message: "Unknown error" } }));
    const errorMessage = body.error?.message || `HTTP ${res.status}`;
    throw new HetznerApiError(res.status, `Hetzner API ${path} failed: ${errorMessage}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return undefined;
  return res.json();
}

/**
 * Paginate a Hetzner list endpoint, collecting all pages.
 * `key` is the response field holding the array (e.g. "server_types").
 */
async function hetznerListAll<T>(apiKey: string, path: string, key: string): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  const sep = path.includes("?") ? "&" : "?";

  while (true) {
    const data = await hetznerFetch(apiKey, `${path}${sep}page=${page}&per_page=50`);
    const items: T[] = data[key] ?? [];
    results.push(...items);

    const lastPage = data.meta?.pagination?.last_page ?? page;
    if (page >= lastPage) break;
    page++;
  }

  return results;
}

export async function listLocations(apiKey: string): Promise<HetznerLocation[]> {
  return hetznerListAll(apiKey, "/locations", "locations");
}

export async function listServerTypes(apiKey: string): Promise<HetznerServerType[]> {
  return hetznerListAll(apiKey, "/server_types", "server_types");
}

export async function listImages(apiKey: string): Promise<HetznerImage[]> {
  // Filter to only OS images (not snapshots/backups)
  return hetznerListAll(apiKey, "/images?type=system", "images");
}

export async function listSshKeys(apiKey: string): Promise<HetznerSshKey[]> {
  return hetznerListAll(apiKey, "/ssh_keys", "ssh_keys");
}

export async function createSshKey(apiKey: string, name: string, publicKey: string): Promise<HetznerSshKey> {
  const data = await hetznerFetch(apiKey, "/ssh_keys", {
    method: "POST",
    body: JSON.stringify({ name, public_key: publicKey }),
  });
  return data.ssh_key;
}

export async function createServer(
  apiKey: string,
  opts: {
    name: string;
    server_type: string;
    location: string;
    image: string | number;
    ssh_keys: number[];
    user_data?: string; // cloud-init script (not base64 for Hetzner)
    firewalls?: Array<{ firewall: number }>;
    labels?: Record<string, string>;
  },
): Promise<HetznerServer> {
  const data = await hetznerFetch(apiKey, "/servers", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  return data.server;
}

export async function getServer(apiKey: string, serverId: number): Promise<HetznerServer> {
  const data = await hetznerFetch(apiKey, `/servers/${serverId}`);
  return data.server;
}

export async function deleteServer(apiKey: string, serverId: number): Promise<void> {
  await hetznerFetch(apiKey, `/servers/${serverId}`, { method: "DELETE" });
}

// --- Firewalls ---

export async function listFirewalls(apiKey: string): Promise<HetznerFirewall[]> {
  return hetznerListAll(apiKey, "/firewalls", "firewalls");
}

export async function createFirewall(
  apiKey: string,
  name: string,
  rules: Array<{
    direction: "in" | "out";
    protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
    source_ips: string[];
    port?: string;
    description?: string;
  }>,
): Promise<HetznerFirewall> {
  const data = await hetznerFetch(apiKey, "/firewalls", {
    method: "POST",
    body: JSON.stringify({ name, rules }),
  });
  return data.firewall;
}

export async function getFirewall(apiKey: string, firewallId: number): Promise<HetznerFirewall> {
  const data = await hetznerFetch(apiKey, `/firewalls/${firewallId}`);
  return data.firewall;
}

export async function deleteFirewall(apiKey: string, firewallId: number): Promise<void> {
  await hetznerFetch(apiKey, `/firewalls/${firewallId}`, { method: "DELETE" });
}

export async function applyFirewallToServer(
  apiKey: string,
  firewallId: number,
  serverId: number,
): Promise<void> {
  await hetznerFetch(apiKey, `/firewalls/${firewallId}/actions/apply_to_resources`, {
    method: "POST",
    body: JSON.stringify({
      apply_to: [{
        type: "server",
        server: { id: serverId },
      }],
    }),
  });
}