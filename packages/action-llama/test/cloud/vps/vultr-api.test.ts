import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  listRegions,
  listPlans,
  listOsImages,
  listSshKeys,
  createSshKey,
  createInstance,
  getInstance,
  deleteInstance,
  listFirewallGroups,
  createFirewallGroup,
  createFirewallRule,
  listFirewallRules,
  getFirewallGroup,
  deleteFirewallGroup,
} from "../../../src/cloud/vps/vultr-api.js";

const API_KEY = "test-vultr-key";

function mockResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe("Vultr API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("listRegions returns regions array", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      regions: [{ id: "ewr", city: "New Jersey", country: "US", continent: "North America", options: [] }],
    }));

    const regions = await listRegions(API_KEY);
    expect(regions).toHaveLength(1);
    expect(regions[0].id).toBe("ewr");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.vultr.com/v2/regions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }),
      }),
    );
  });

  it("listPlans returns plans array", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      plans: [{ id: "vc2-2c-4gb", vcpu_count: 2, ram: 4096, disk: 80, bandwidth: 3, monthly_cost: 24, type: "vc2", locations: ["ewr"] }],
    }));

    const plans = await listPlans(API_KEY);
    expect(plans).toHaveLength(1);
    expect(plans[0].vcpu_count).toBe(2);
  });

  it("listPlans with type filter appends query parameter", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      plans: [{ id: "vc2-2c-4gb", vcpu_count: 2, ram: 4096, disk: 80, bandwidth: 3, monthly_cost: 24, type: "vc2", locations: ["ewr"] }],
    }));

    const plans = await listPlans(API_KEY, "vc2");
    expect(plans).toHaveLength(1);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("?type=vc2");
  });

  it("listOsImages returns OS array", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      os: [{ id: 2284, name: "Ubuntu 24.04 LTS x64", arch: "x64", family: "ubuntu" }],
    }));

    const images = await listOsImages(API_KEY);
    expect(images[0].id).toBe(2284);
  });

  it("listSshKeys returns SSH keys", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      ssh_keys: [{ id: "abc123", name: "mykey", ssh_key: "ssh-rsa AAAA...", date_created: "2025-01-01" }],
    }));

    const keys = await listSshKeys(API_KEY);
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe("mykey");
  });

  it("createSshKey posts key and returns result", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      ssh_key: { id: "new-id", name: "action-llama", ssh_key: "ssh-rsa ...", date_created: "2025-01-01" },
    }));

    const key = await createSshKey(API_KEY, "action-llama", "ssh-rsa ...");
    expect(key.id).toBe("new-id");

    const [, callOpts] = mockFetch.mock.calls[0];
    expect(callOpts.method).toBe("POST");
    expect(JSON.parse(callOpts.body)).toEqual({ name: "action-llama", ssh_key: "ssh-rsa ..." });
  });

  it("createInstance posts instance config", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      instance: {
        id: "inst-123", os: "Ubuntu 24.04", ram: 4096, disk: 80,
        main_ip: "0.0.0.0", vcpu_count: 2, region: "ewr", plan: "vc2-2c-4gb",
        status: "pending", power_status: "stopped", server_status: "none",
        label: "action-llama", date_created: "2025-01-01",
      },
    }));

    const inst = await createInstance(API_KEY, {
      region: "ewr", plan: "vc2-2c-4gb", os_id: 2284,
      sshkey_id: ["abc123"], label: "action-llama",
    });
    expect(inst.id).toBe("inst-123");
    expect(inst.status).toBe("pending");
  });

  it("getInstance returns instance details", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      instance: {
        id: "inst-123", os: "Ubuntu 24.04", ram: 4096, disk: 80,
        main_ip: "5.6.7.8", vcpu_count: 2, region: "ewr", plan: "vc2-2c-4gb",
        status: "active", power_status: "running", server_status: "ok",
        label: "action-llama", date_created: "2025-01-01",
      },
    }));

    const inst = await getInstance(API_KEY, "inst-123");
    expect(inst.main_ip).toBe("5.6.7.8");
    expect(inst.status).toBe("active");
  });

  it("deleteInstance sends DELETE request", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined), text: () => Promise.resolve("") });

    await deleteInstance(API_KEY, "inst-123");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.vultr.com/v2/instances/inst-123");
    expect(opts.method).toBe("DELETE");
  });

  it("throws VultrApiError on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 403, text: () => Promise.resolve("Forbidden"),
    });

    await expect(listRegions(API_KEY)).rejects.toThrow("Vultr API /regions failed (HTTP 403)");
  });

  it("throws VultrApiError with empty body when res.text() rejects", async () => {
    // When res.text() throws, the .catch(() => "") fallback is used, yielding an empty body string
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 500, text: () => Promise.reject(new Error("body read failed")),
    });

    const err = await listRegions(API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Vultr API /regions failed (HTTP 500)");
    // Body should be empty string from the catch fallback
    expect(err.message).not.toContain("body read failed");
  });

  describe("Firewall Groups", () => {
    it("listFirewallGroups returns firewall groups", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        firewall_groups: [
          {
            id: "fg-abc", description: "action-llama",
            date_created: "2025-01-01", date_modified: "2025-01-01",
            instance_count: 2, rule_count: 3, max_rule_count: 50,
          },
        ],
      }));

      const groups = await listFirewallGroups(API_KEY);
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe("fg-abc");
      expect(groups[0].description).toBe("action-llama");
      expect(groups[0].instance_count).toBe(2);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.vultr.com/v2/firewalls");
    });

    it("createFirewallGroup posts description and returns created group", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        firewall_group: {
          id: "fg-new", description: "action-llama",
          date_created: "2025-01-01", date_modified: "2025-01-01",
          instance_count: 0, rule_count: 0, max_rule_count: 50,
        },
      }));

      const group = await createFirewallGroup(API_KEY, "action-llama");
      expect(group.id).toBe("fg-new");
      expect(group.description).toBe("action-llama");
      expect(group.instance_count).toBe(0);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.vultr.com/v2/firewalls");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ description: "action-llama" });
    });

    it("createFirewallRule posts rule to the group endpoint", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({}), text: () => Promise.resolve("") });

      await createFirewallRule(API_KEY, "fg-abc", {
        ip_type: "v4",
        protocol: "tcp",
        subnet: "0.0.0.0",
        subnet_size: 0,
        port: "22",
        notes: "SSH access",
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.vultr.com/v2/firewalls/fg-abc/rules");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.protocol).toBe("tcp");
      expect(body.port).toBe("22");
      expect(body.ip_type).toBe("v4");
    });

    it("listFirewallRules returns rules for a group", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        firewall_rules: [
          { id: 1, ip_type: "v4", protocol: "tcp", port: "22", subnet: "0.0.0.0", subnet_size: 0, notes: "SSH" },
        ],
      }));

      const rules = await listFirewallRules(API_KEY, "fg-abc");
      expect(rules).toHaveLength(1);
      expect(rules[0].protocol).toBe("tcp");
      expect(rules[0].port).toBe("22");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.vultr.com/v2/firewalls/fg-abc/rules");
    });

    it("getFirewallGroup returns group details", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        firewall_group: {
          id: "fg-abc", description: "action-llama",
          date_created: "2025-01-01", date_modified: "2025-01-01",
          instance_count: 1, rule_count: 3, max_rule_count: 50,
        },
      }));

      const group = await getFirewallGroup(API_KEY, "fg-abc");
      expect(group.id).toBe("fg-abc");
      expect(group.instance_count).toBe(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.vultr.com/v2/firewalls/fg-abc");
    });

    it("deleteFirewallGroup sends DELETE request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(undefined), text: () => Promise.resolve("") });

      await deleteFirewallGroup(API_KEY, "fg-abc");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.vultr.com/v2/firewalls/fg-abc");
      expect(opts.method).toBe("DELETE");
    });
  });
});
