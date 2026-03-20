import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import vultrApiKey from "../../../src/credentials/builtins/vultr-api-key.js";

describe("vultr_api_key credential", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct id and fields", () => {
    expect(vultrApiKey.id).toBe("vultr_api_key");
    expect(vultrApiKey.fields).toHaveLength(1);
    expect(vultrApiKey.fields[0].name).toBe("api_key");
    expect(vultrApiKey.fields[0].secret).toBe(true);
  });

  it("has helpUrl pointing to Vultr settings", () => {
    expect(vultrApiKey.helpUrl).toContain("vultr.com");
  });

  it("maps api_key field to VULTR_API_KEY env var", () => {
    expect(vultrApiKey.envVars?.api_key).toBe("VULTR_API_KEY");
  });

  it("validate succeeds when API returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ account: {} }) });

    const result = await vultrApiKey.validate!({ api_key: "test-key" });
    expect(result).toBe(true);

    expect(mockFetch).toHaveBeenCalledWith("https://api.vultr.com/v2/account", {
      headers: { Authorization: "Bearer test-key" },
    });
  });

  it("validate throws when API returns 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(vultrApiKey.validate!({ api_key: "bad-key" })).rejects.toThrow(
      "Vultr API key validation failed (HTTP 401)",
    );
  });
});
