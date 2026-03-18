/**
 * Cloudflare REST API client.
 * Plain fetch() wrapper — no SDK dependency.
 */

const BASE_URL = "https://api.cloudflare.com/client/v4";

// Origin CA uses a separate endpoint
const ORIGIN_CA_URL = "https://api.cloudflare.com/client/v4/certificates";

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

export interface CloudflareOriginCertificate {
  id: string;
  certificate: string;
  private_key: string;
  hostnames: string[];
  expires_on: string;
}

export class CloudflareApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

async function cfFetch(
  token: string,
  path: string,
  options: RequestInit = {},
  baseUrl: string = BASE_URL,
): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CloudflareApiError(res.status, `Cloudflare API ${path} failed (HTTP ${res.status}): ${body}`);
  }

  const data = await res.json();
  if (!data.success) {
    const errors = data.errors?.map((e: any) => e.message).join(", ") ?? "Unknown error";
    throw new CloudflareApiError(res.status, `Cloudflare API ${path} failed: ${errors}`);
  }

  return data;
}

export async function verifyToken(token: string): Promise<boolean> {
  const data = await cfFetch(token, "/user/tokens/verify");
  return data.result?.status === "active";
}

export async function listZones(token: string, name: string): Promise<CloudflareZone[]> {
  const data = await cfFetch(token, `/zones?name=${encodeURIComponent(name)}`);
  return data.result;
}

export async function findDnsRecord(
  token: string,
  zoneId: string,
  hostname: string,
): Promise<CloudflareDnsRecord | undefined> {
  const data = await cfFetch(token, `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(hostname)}`);
  return data.result?.[0];
}

export async function createDnsRecord(
  token: string,
  zoneId: string,
  hostname: string,
  ip: string,
  proxied: boolean = true,
): Promise<CloudflareDnsRecord> {
  const data = await cfFetch(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "A", name: hostname, content: ip, proxied, ttl: 1 }),
  });
  return data.result;
}

export async function updateDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
  hostname: string,
  ip: string,
  proxied: boolean = true,
): Promise<CloudflareDnsRecord> {
  const data = await cfFetch(token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PUT",
    body: JSON.stringify({ type: "A", name: hostname, content: ip, proxied, ttl: 1 }),
  });
  return data.result;
}

export async function deleteDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
): Promise<void> {
  await cfFetch(token, `/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
}

/**
 * Create/update an A record for the given hostname.
 * Returns the DNS record (created or updated).
 */
export async function upsertDnsRecord(
  token: string,
  zoneId: string,
  hostname: string,
  ip: string,
  proxied: boolean = true,
): Promise<CloudflareDnsRecord> {
  const existing = await findDnsRecord(token, zoneId, hostname);
  if (existing) {
    return updateDnsRecord(token, zoneId, existing.id, hostname, ip, proxied);
  }
  return createDnsRecord(token, zoneId, hostname, ip, proxied);
}

/**
 * Create a Cloudflare Origin CA certificate.
 * Uses the Origin CA endpoint (same API token).
 */
export async function createOriginCertificate(
  token: string,
  hostnames: string[],
  validityDays: number = 5475, // 15 years (CF Origin CA max)
): Promise<CloudflareOriginCertificate> {
  const data = await cfFetch(
    token,
    "",
    {
      method: "POST",
      body: JSON.stringify({
        hostnames,
        requested_validity: validityDays,
        request_type: "origin-rsa",
        csr: "", // Let CF generate the key pair
      }),
    },
    ORIGIN_CA_URL,
  );
  return data.result;
}

/**
 * Set the SSL/TLS mode for a zone.
 * Modes: "off", "flexible", "full", "strict"
 */
export async function setSslMode(
  token: string,
  zoneId: string,
  mode: "off" | "flexible" | "full" | "strict",
): Promise<void> {
  await cfFetch(token, `/zones/${zoneId}/settings/ssl`, {
    method: "PATCH",
    body: JSON.stringify({ value: mode }),
  });
}
