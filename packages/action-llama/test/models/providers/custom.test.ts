import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CustomProvider } from "../../../src/models/providers/custom.js";

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    provider: "custom",
    model: "my-model",
    baseUrl: "https://example.com/v1",
    ...overrides,
  };
}

function makeSuccessResponse(content: string, model = "my-model") {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(""),
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model,
    }),
  };
}

describe("CustomProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch" as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CUSTOM_API_KEY;
  });

  describe("constructor", () => {
    it("creates provider with baseUrl from config", () => {
      const provider = new CustomProvider(makeConfig({ baseUrl: "https://api.example.com" }));
      expect(provider.name).toBe("custom");
    });

    it("throws when baseUrl is missing", () => {
      expect(() => new CustomProvider(makeConfig({ baseUrl: undefined }))).toThrow(
        "Custom provider requires baseUrl in configuration"
      );
    });

    it("uses apiKey from config when provided", () => {
      const provider = new CustomProvider(makeConfig({ apiKey: "my-key" }));
      expect(provider.name).toBe("custom");
    });

    it("falls back to CUSTOM_API_KEY env var when config apiKey is missing", () => {
      process.env.CUSTOM_API_KEY = "env-key-123";
      const provider = new CustomProvider(makeConfig({ apiKey: undefined }));
      expect(provider.name).toBe("custom");
    });
  });

  describe("init", () => {
    it("resolves when baseUrl is set", async () => {
      const provider = new CustomProvider(makeConfig());
      await expect(provider.init()).resolves.toBeUndefined();
    });
  });

  describe("validateConfig", () => {
    it("resolves for valid config with baseUrl", async () => {
      const provider = new CustomProvider(makeConfig());
      await expect(provider.validateConfig(makeConfig())).resolves.toBeUndefined();
    });

    it("throws when baseUrl is missing from config passed to validateConfig", async () => {
      const provider = new CustomProvider(makeConfig());
      await expect(provider.validateConfig({ provider: "custom" })).rejects.toThrow(
        "Custom provider requires baseUrl in configuration"
      );
    });

    it("throws when baseUrl is not a valid URL", async () => {
      const provider = new CustomProvider(makeConfig());
      await expect(
        provider.validateConfig(makeConfig({ baseUrl: "not-a-url" }))
      ).rejects.toThrow("Invalid baseUrl provided for custom provider");
    });
  });

  describe("getDefaultModel", () => {
    it("returns model from config", () => {
      const provider = new CustomProvider(makeConfig({ model: "gpt-4" }));
      expect(provider.getDefaultModel()).toBe("gpt-4");
    });

    it("returns fallback model when config model is not set", () => {
      const provider = new CustomProvider(makeConfig({ model: undefined }));
      expect(provider.getDefaultModel()).toBe("gpt-3.5-turbo");
    });
  });

  describe("chat", () => {
    it("calls chat completions endpoint and returns response", async () => {
      const provider = new CustomProvider(makeConfig({ apiKey: "test-key" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("Hello world") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://example.com/v1/chat/completions");
      expect((options as any).method).toBe("POST");
      expect(result.content).toBe("Hello world");
    });

    it("includes Authorization header when apiKey is provided", async () => {
      const provider = new CustomProvider(makeConfig({ apiKey: "bearer-token" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("response") as any);

      await provider.chat([{ role: "user", content: "Hi" }]);

      const options = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((options.headers as any)["Authorization"]).toBe("Bearer bearer-token");
    });

    it("does not include Authorization header when no apiKey", async () => {
      const provider = new CustomProvider(makeConfig({ apiKey: "" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("response") as any);

      await provider.chat([{ role: "user", content: "Hi" }]);

      const options = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((options.headers as any)["Authorization"]).toBeUndefined();
    });

    it("returns usage stats from response", async () => {
      const provider = new CustomProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("result") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);

      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it("returns finish_reason from response", async () => {
      const provider = new CustomProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("result") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);

      expect(result.finish_reason).toBe("stop");
    });

    it("throws on non-ok HTTP response", async () => {
      const provider = new CustomProvider(makeConfig());
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue("Unauthorized"),
      } as any);

      await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "Custom API error (401): Unauthorized"
      );
    });

    it("uses model from options when provided", async () => {
      const provider = new CustomProvider(makeConfig({ model: "default-model" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("result", "override-model") as any);

      await provider.chat([{ role: "user", content: "Hi" }], { model: "override-model" });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(body.model).toBe("override-model");
    });

    it("trims trailing slash from baseUrl", async () => {
      const provider = new CustomProvider(makeConfig({ baseUrl: "https://example.com/v1/" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("result") as any);

      await provider.chat([{ role: "user", content: "Hi" }]);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://example.com/v1/chat/completions");
    });
  });

  describe("listModels", () => {
    it("returns list of model ids from models endpoint", async () => {
      const provider = new CustomProvider(makeConfig({ apiKey: "key" }));
      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ id: "model-a" }, { id: "model-b" }] }),
      } as any);

      const models = await provider.listModels();

      expect(models).toEqual(["model-a", "model-b"]);
    });

    it("returns default model when models endpoint returns non-ok", async () => {
      const provider = new CustomProvider(makeConfig({ model: "default-m" }));
      fetchSpy.mockResolvedValue({ ok: false, status: 404 } as any);

      const models = await provider.listModels();

      expect(models).toEqual(["default-m"]);
    });

    it("returns default model when fetch throws", async () => {
      const provider = new CustomProvider(makeConfig({ model: "fallback-m" }));
      fetchSpy.mockRejectedValue(new Error("network error"));

      const models = await provider.listModels();

      expect(models).toEqual(["fallback-m"]);
    });
  });

  describe("shutdown", () => {
    it("resolves without errors", async () => {
      const provider = new CustomProvider(makeConfig());
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
});
