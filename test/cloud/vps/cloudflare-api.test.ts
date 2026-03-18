import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  verifyToken,
  listAllZones,
  listZones,
  findDnsRecord,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  upsertDnsRecord,
  createOriginCertificate,
  getSslMode,
  setSslMode,
  CloudflareApiError,
} from "../../../src/cloud/vps/cloudflare-api.js";

const TOKEN = "test-cf-token";

function mockResponse(result: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({ success: true, result, errors: [] }),
    text: () => Promise.resolve(JSON.stringify({ success: true, result })),
  };
}

function mockErrorResponse(status: number, message = "error") {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ success: false, errors: [{ message }] }),
    text: () => Promise.resolve(JSON.stringify({ success: false, errors: [{ message }] })),
  };
}

describe("Cloudflare API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("verifyToken returns true for active token", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: "active" }));

    const active = await verifyToken(TOKEN);
    expect(active).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
  });

  it("verifyToken returns false for inactive token", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: "disabled" }));
    const active = await verifyToken(TOKEN);
    expect(active).toBe(false);
  });

  it("verifyToken falls back to /zones for account API tokens", async () => {
    // /user/tokens/verify fails for account tokens
    mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));
    // Fallback /zones?per_page=1 succeeds
    mockFetch.mockResolvedValueOnce(mockResponse([{ id: "zone-1", name: "example.com", status: "active" }]));

    const active = await verifyToken(TOKEN);
    expect(active).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudflare.com/client/v4/zones?per_page=1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
  });

  it("verifyToken returns false when both verify and zones fail", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));
    mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

    const active = await verifyToken(TOKEN);
    expect(active).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("listAllZones returns all zones across pages", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `z-${i}`, name: `d${i}.com`, status: "active" }));
    const page2 = [{ id: "z-50", name: "d50.com", status: "active" }];
    mockFetch.mockResolvedValueOnce(mockResponse(page1));
    mockFetch.mockResolvedValueOnce(mockResponse(page2));

    const result = await listAllZones(TOKEN);
    expect(result).toHaveLength(51);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.cloudflare.com/client/v4/zones?per_page=50&page=1",
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudflare.com/client/v4/zones?per_page=50&page=2",
      expect.anything(),
    );
  });

  it("listAllZones returns single page when fewer than 50 zones", async () => {
    const zones = [{ id: "z-1", name: "example.com", status: "active" }];
    mockFetch.mockResolvedValueOnce(mockResponse(zones));

    const result = await listAllZones(TOKEN);
    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("listZones returns zones for a domain", async () => {
    const zones = [{ id: "zone-1", name: "example.com", status: "active" }];
    mockFetch.mockResolvedValueOnce(mockResponse(zones));

    const result = await listZones(TOKEN, "example.com");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("zone-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones?name=example.com",
      expect.anything(),
    );
  });

  it("findDnsRecord returns matching record", async () => {
    const records = [{ id: "rec-1", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 }];
    mockFetch.mockResolvedValueOnce(mockResponse(records));

    const record = await findDnsRecord(TOKEN, "zone-1", "agents.example.com");
    expect(record).toBeDefined();
    expect(record!.id).toBe("rec-1");
  });

  it("findDnsRecord returns undefined when no match", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    const record = await findDnsRecord(TOKEN, "zone-1", "missing.example.com");
    expect(record).toBeUndefined();
  });

  it("createDnsRecord creates A record", async () => {
    const created = { id: "rec-new", type: "A", name: "agents.example.com", content: "5.6.7.8", proxied: true, ttl: 1 };
    mockFetch.mockResolvedValueOnce(mockResponse(created));

    const result = await createDnsRecord(TOKEN, "zone-1", "agents.example.com", "5.6.7.8");
    expect(result.id).toBe("rec-new");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "A", name: "agents.example.com", content: "5.6.7.8", proxied: true, ttl: 1 }),
      }),
    );
  });

  it("updateDnsRecord updates existing record", async () => {
    const updated = { id: "rec-1", type: "A", name: "agents.example.com", content: "9.8.7.6", proxied: true, ttl: 1 };
    mockFetch.mockResolvedValueOnce(mockResponse(updated));

    const result = await updateDnsRecord(TOKEN, "zone-1", "rec-1", "agents.example.com", "9.8.7.6");
    expect(result.content).toBe("9.8.7.6");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-1",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("deleteDnsRecord deletes a record", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: "rec-1" }));

    await deleteDnsRecord(TOKEN, "zone-1", "rec-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("upsertDnsRecord creates when no existing record", async () => {
    // findDnsRecord returns empty
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    // createDnsRecord
    const created = { id: "rec-new", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 };
    mockFetch.mockResolvedValueOnce(mockResponse(created));

    const result = await upsertDnsRecord(TOKEN, "zone-1", "agents.example.com", "1.2.3.4");
    expect(result.id).toBe("rec-new");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("upsertDnsRecord updates when record exists", async () => {
    // findDnsRecord returns existing
    const existing = [{ id: "rec-old", type: "A", name: "agents.example.com", content: "0.0.0.0", proxied: true, ttl: 1 }];
    mockFetch.mockResolvedValueOnce(mockResponse(existing));
    // updateDnsRecord
    const updated = { id: "rec-old", type: "A", name: "agents.example.com", content: "1.2.3.4", proxied: true, ttl: 1 };
    mockFetch.mockResolvedValueOnce(mockResponse(updated));

    const result = await upsertDnsRecord(TOKEN, "zone-1", "agents.example.com", "1.2.3.4");
    expect(result.id).toBe("rec-old");
    expect(result.content).toBe("1.2.3.4");
  });

  it("createOriginCertificate creates certificate", async () => {
    const cert = {
      id: "cert-1",
      certificate: "-----BEGIN CERTIFICATE-----",
      private_key: "-----BEGIN PRIVATE KEY-----",
      hostnames: ["agents.example.com"],
      expires_on: "2041-01-01T00:00:00Z",
    };
    mockFetch.mockResolvedValueOnce(mockResponse(cert));

    const result = await createOriginCertificate(TOKEN, ["agents.example.com"], 5475);
    expect(result.id).toBe("cert-1");
    expect(result.certificate).toContain("CERTIFICATE");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/certificates",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getSslMode returns current SSL mode", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ value: "strict" }));

    const mode = await getSslMode(TOKEN, "zone-1");
    expect(mode).toBe("strict");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-1/settings/ssl",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
  });

  it("setSslMode sends PATCH request", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}));

    await setSslMode(TOKEN, "zone-1", "strict");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-1/settings/ssl",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ value: "strict" }),
      }),
    );
  });

  it("throws CloudflareApiError on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

    await expect(listZones("bad-token", "example.com")).rejects.toThrow(CloudflareApiError);
  });
});
