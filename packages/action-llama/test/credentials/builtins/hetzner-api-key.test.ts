import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import hetznerApiKey from "../../../src/credentials/builtins/hetzner-api-key.js";

describe("hetzner_api_key credential", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct id", () => {
    expect(hetznerApiKey.id).toBe("hetzner_api_key");
  });

  it("has a single api_key field marked as secret", () => {
    expect(hetznerApiKey.fields).toHaveLength(1);
    expect(hetznerApiKey.fields[0].name).toBe("api_key");
    expect(hetznerApiKey.fields[0].secret).toBe(true);
  });

  it("maps api_key field to HETZNER_API_KEY env var", () => {
    expect(hetznerApiKey.envVars?.api_key).toBe("HETZNER_API_KEY");
  });

  it("has helpUrl pointing to Hetzner console", () => {
    expect(hetznerApiKey.helpUrl).toContain("hetzner.cloud");
  });

  it("has agentContext with HETZNER_API_KEY reference", () => {
    expect(hetznerApiKey.agentContext).toContain("HETZNER_API_KEY");
  });

  describe("validate", () => {
    it("returns true when API returns 200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ server_types: [] }),
      });

      const result = await hetznerApiKey.validate!({ api_key: "test-key" });
      expect(result).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/server_types",
        { headers: { Authorization: "Bearer test-key" } }
      );
    });

    it("throws when API returns non-ok response with error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: "Invalid API key" } }),
      });

      await expect(hetznerApiKey.validate!({ api_key: "bad-key" })).rejects.toThrow(
        "Hetzner API key validation failed: Invalid API key"
      );
    });

    it("throws with HTTP status when error message is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      });

      await expect(hetznerApiKey.validate!({ api_key: "bad-key" })).rejects.toThrow(
        "Hetzner API key validation failed: HTTP 403"
      );
    });

    it("throws with 'Unknown error' when json parsing fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("json parse error")),
      });

      await expect(hetznerApiKey.validate!({ api_key: "bad-key" })).rejects.toThrow(
        "Hetzner API key validation failed: Unknown error"
      );
    });
  });
});
