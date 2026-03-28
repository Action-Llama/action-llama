import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/shared/config.js", () => ({
  loadGlobalConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/shared/credentials.js", () => ({
  loadCredentialField: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { gatewayFetch, gatewayJson } from "../../src/cli/gateway-client.js";
import * as config from "../../src/shared/config.js";
import * as credentials from "../../src/shared/credentials.js";

const mockedLoadGlobalConfig = vi.mocked(config.loadGlobalConfig);
const mockedLoadCredentialField = vi.mocked(credentials.loadCredentialField);

describe("gatewayFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as any);
    mockedLoadGlobalConfig.mockReturnValue({} as any);
    mockedLoadCredentialField.mockResolvedValue(undefined);
  });

  it("makes a GET request to http://localhost:8080 by default", async () => {
    await gatewayFetch({ project: "/my/project", path: "/api/status" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/status");
    expect(init.method).toBe("GET");
  });

  it("uses the configured gateway port when set in globalConfig", async () => {
    mockedLoadGlobalConfig.mockReturnValue({ gateway: { port: 9090 } } as any);

    await gatewayFetch({ project: "/my/project", path: "/health" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:9090/health");
  });

  it("uses the configured gateway URL when set in globalConfig", async () => {
    mockedLoadGlobalConfig.mockReturnValue({ gateway: { url: "https://remote.example.com" } } as any);

    await gatewayFetch({ project: "/my/project", path: "/api/agents" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://remote.example.com/api/agents");
  });

  it("includes Authorization header when API key is present", async () => {
    mockedLoadCredentialField.mockResolvedValue("my-secret-key");

    await gatewayFetch({ project: "/my/project", path: "/secure" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer my-secret-key");
  });

  it("omits Authorization header when no API key is found", async () => {
    mockedLoadCredentialField.mockResolvedValue(undefined);

    await gatewayFetch({ project: "/my/project", path: "/open" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Authorization"]).toBeUndefined();
  });

  it("uses the specified HTTP method", async () => {
    await gatewayFetch({ project: "/my/project", path: "/api/action", method: "POST" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
  });

  it("sends JSON body and sets Content-Type header when body is provided", async () => {
    const body = { agentName: "my-agent" };

    await gatewayFetch({ project: "/my/project", path: "/api/trigger", method: "POST", body });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("does not set Content-Type or body when body is undefined", async () => {
    await gatewayFetch({ project: "/my/project", path: "/api/status" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("loads gateway API key from credential field 'gateway_api_key'", async () => {
    await gatewayFetch({ project: "/my/project", path: "/api/status" });

    expect(mockedLoadCredentialField).toHaveBeenCalledWith("gateway_api_key", "default", "key");
  });
});

describe("gatewayJson", () => {
  it("parses and returns valid JSON from a response", async () => {
    const response = {
      status: 200,
      text: async () => JSON.stringify({ agents: ["a", "b"] }),
    } as any;

    const result = await gatewayJson(response);
    expect(result).toEqual({ agents: ["a", "b"] });
  });

  it("throws a descriptive error when response body is not valid JSON", async () => {
    const response = {
      status: 502,
      text: async () => "<html><body>Bad Gateway</body></html>",
    } as any;

    await expect(gatewayJson(response)).rejects.toThrow(
      "Gateway returned non-JSON response (HTTP 502)"
    );
  });

  it("includes the response body preview in the error message", async () => {
    const htmlBody = "<html><body>Something went wrong</body></html>";
    const response = {
      status: 503,
      text: async () => htmlBody,
    } as any;

    await expect(gatewayJson(response)).rejects.toThrow(htmlBody.slice(0, 50));
  });

  it("truncates very long non-JSON responses in the error message", async () => {
    const longBody = "x".repeat(200);
    const response = {
      status: 500,
      text: async () => longBody,
    } as any;

    let errorMessage = "";
    try {
      await gatewayJson(response);
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toContain("…");
    // Should not include the full 200-char body
    expect(errorMessage.length).toBeLessThan(longBody.length + 100);
  });
});
