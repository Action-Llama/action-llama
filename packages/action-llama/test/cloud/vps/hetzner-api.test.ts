import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  listLocations,
  listServerTypes,
  listImages,
  listSshKeys,
  createSshKey,
  createServer,
  getServer,
  deleteServer,
  listFirewalls,
  createFirewall,
  getFirewall,
  deleteFirewall,
  applyFirewallToServer,
} from "../../../src/cloud/vps/hetzner-api.js";

const API_KEY = "test-hetzner-key";
const BASE_URL = "https://api.hetzner.cloud/v1";

function mockResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

/** Single-page list response with no pagination. */
function mockListResponse(key: string, items: any[]) {
  return mockResponse({ [key]: items, meta: { pagination: { page: 1, last_page: 1 } } });
}

describe("Hetzner Cloud API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("listLocations", () => {
    it("returns locations array", async () => {
      const location = {
        id: 1, name: "fsn1", description: "Falkenstein DC Park 1",
        country: "DE", city: "Falkenstein", latitude: 50.4779, longitude: 12.3713,
        network_zone: "eu-central",
      };
      mockFetch.mockResolvedValueOnce(mockListResponse("locations", [location]));

      const locations = await listLocations(API_KEY);
      expect(locations).toHaveLength(1);
      expect(locations[0].name).toBe("fsn1");
      expect(locations[0].country).toBe("DE");
    });

    it("sends correct Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(mockListResponse("locations", []));

      await listLocations(API_KEY);
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    });

    it("handles pagination across multiple pages", async () => {
      const loc1 = { id: 1, name: "fsn1", description: "D1", country: "DE", city: "F", latitude: 1, longitude: 2, network_zone: "eu" };
      const loc2 = { id: 2, name: "nbg1", description: "D2", country: "DE", city: "N", latitude: 3, longitude: 4, network_zone: "eu" };

      mockFetch
        .mockResolvedValueOnce(mockResponse({
          locations: [loc1],
          meta: { pagination: { page: 1, last_page: 2 } },
        }))
        .mockResolvedValueOnce(mockResponse({
          locations: [loc2],
          meta: { pagination: { page: 2, last_page: 2 } },
        }));

      const locations = await listLocations(API_KEY);
      expect(locations).toHaveLength(2);
      expect(locations[0].name).toBe("fsn1");
      expect(locations[1].name).toBe("nbg1");
    });
  });

  describe("listServerTypes", () => {
    it("returns server types array", async () => {
      const serverType = {
        id: 1, name: "cx22", description: "CX22", cores: 2, memory: 4, disk: 40,
        architecture: "x86", deprecation: null, prices: [], locations: [],
      };
      mockFetch.mockResolvedValueOnce(mockListResponse("server_types", [serverType]));

      const types = await listServerTypes(API_KEY);
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe("cx22");
      expect(types[0].cores).toBe(2);
    });
  });

  describe("listImages", () => {
    it("returns images array", async () => {
      const image = {
        id: 15512617, type: "system", status: "available", name: "ubuntu-24.04",
        description: "Ubuntu 24.04", os_flavor: "ubuntu", os_version: "24.04",
        architecture: "x86", deprecated: null,
      };
      mockFetch.mockResolvedValueOnce(mockListResponse("images", [image]));

      const images = await listImages(API_KEY);
      expect(images).toHaveLength(1);
      expect(images[0].os_flavor).toBe("ubuntu");
      expect(images[0].os_version).toBe("24.04");
    });

    it("requests only system images", async () => {
      mockFetch.mockResolvedValueOnce(mockListResponse("images", []));

      await listImages(API_KEY);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("type=system");
    });
  });

  describe("listSshKeys", () => {
    it("returns ssh_keys array", async () => {
      const key = {
        id: 42, name: "my-key", fingerprint: "ab:cd:ef", public_key: "ssh-rsa AAAA...",
        labels: {}, created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockListResponse("ssh_keys", [key]));

      const keys = await listSshKeys(API_KEY);
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe("my-key");
    });
  });

  describe("createSshKey", () => {
    it("posts key data and returns created ssh_key", async () => {
      const created = {
        id: 99, name: "action-llama", fingerprint: "11:22:33",
        public_key: "ssh-rsa AAAA...", labels: {}, created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ ssh_key: created }));

      const result = await createSshKey(API_KEY, "action-llama", "ssh-rsa AAAA...");
      expect(result.id).toBe(99);
      expect(result.name).toBe("action-llama");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/ssh_keys`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ name: "action-llama", public_key: "ssh-rsa AAAA..." });
    });
  });

  describe("createServer", () => {
    it("posts server config and returns created server", async () => {
      const server = {
        id: 123, name: "al-scheduler", status: "initializing",
        public_net: { ipv4: { ip: "1.2.3.4", blocked: false }, ipv6: { ip: "2001::", blocked: false } },
        server_type: { id: 1, name: "cx22", cores: 2, memory: 4, disk: 40 },
        datacenter: { id: 1, name: "fsn1-dc14", location: { id: 1, name: "fsn1", country: "DE", city: "Falkenstein" } },
        created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ server }));

      const result = await createServer(API_KEY, {
        name: "al-scheduler",
        server_type: "cx22",
        location: "fsn1",
        image: "ubuntu-24.04",
        ssh_keys: [42],
      });

      expect(result.id).toBe(123);
      expect(result.status).toBe("initializing");
      expect(result.public_net.ipv4.ip).toBe("1.2.3.4");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/servers`);
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.name).toBe("al-scheduler");
      expect(body.ssh_keys).toEqual([42]);
    });
  });

  describe("getServer", () => {
    it("returns server details", async () => {
      const server = {
        id: 123, name: "al-scheduler", status: "running",
        public_net: { ipv4: { ip: "5.6.7.8", blocked: false }, ipv6: { ip: "2001::", blocked: false } },
        server_type: { id: 1, name: "cx22", cores: 2, memory: 4, disk: 40 },
        datacenter: { id: 1, name: "fsn1-dc14", location: { id: 1, name: "fsn1", country: "DE", city: "Falkenstein" } },
        created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ server }));

      const result = await getServer(API_KEY, 123);
      expect(result.id).toBe(123);
      expect(result.status).toBe("running");
      expect(result.public_net.ipv4.ip).toBe("5.6.7.8");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/servers/123`);
    });
  });

  describe("deleteServer", () => {
    it("sends DELETE request to correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined), text: () => Promise.resolve("") });

      await deleteServer(API_KEY, 123);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/servers/123`);
      expect(opts.method).toBe("DELETE");
    });
  });

  describe("listFirewalls", () => {
    it("returns firewalls array", async () => {
      const firewall = {
        id: 1, name: "action-llama", labels: {},
        rules: [], applied_to: [], created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockListResponse("firewalls", [firewall]));

      const firewalls = await listFirewalls(API_KEY);
      expect(firewalls).toHaveLength(1);
      expect(firewalls[0].name).toBe("action-llama");
    });
  });

  describe("createFirewall", () => {
    it("posts firewall config and returns created firewall", async () => {
      const firewall = {
        id: 10, name: "action-llama", labels: {},
        rules: [{ direction: "in" as const, protocol: "tcp" as const, port: "22", source_ips: ["0.0.0.0/0", "::/0"] }],
        applied_to: [], created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ firewall }));

      const rules = [{ direction: "in" as const, protocol: "tcp" as const, source_ips: ["0.0.0.0/0"], port: "22" }];
      const result = await createFirewall(API_KEY, "action-llama", rules);

      expect(result.id).toBe(10);
      expect(result.name).toBe("action-llama");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/firewalls`);
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.name).toBe("action-llama");
      expect(body.rules).toHaveLength(1);
    });
  });

  describe("getFirewall", () => {
    it("returns firewall details", async () => {
      const firewall = {
        id: 10, name: "action-llama", labels: {}, rules: [],
        applied_to: [{ type: "server", server: 123 }], created: "2025-01-01T00:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ firewall }));

      const result = await getFirewall(API_KEY, 10);
      expect(result.id).toBe(10);
      expect(result.applied_to).toHaveLength(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/firewalls/10`);
    });
  });

  describe("deleteFirewall", () => {
    it("sends DELETE request to correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined), text: () => Promise.resolve("") });

      await deleteFirewall(API_KEY, 10);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/firewalls/10`);
      expect(opts.method).toBe("DELETE");
    });
  });

  describe("applyFirewallToServer", () => {
    it("posts apply_to_resources with correct server ID", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ actions: [] }));

      await applyFirewallToServer(API_KEY, 10, 123);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/firewalls/10/actions/apply_to_resources`);
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.apply_to).toEqual([{ type: "server", server: { id: 123 } }]);
    });
  });

  describe("error handling", () => {
    it("throws on non-OK response with error message containing path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { message: "Forbidden" } }),
      });

      await expect(listLocations(API_KEY)).rejects.toThrow(/Hetzner API.*locations.*failed.*Forbidden/);
    });

    it("throws on 404 with fallback error message when no error body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error("no body")),
      });

      await expect(getServer(API_KEY, 9999)).rejects.toThrow(/servers\/9999 failed/);
    });
  });
});
