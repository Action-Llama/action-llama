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
});
