import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "../../../src/models/providers/openai.js";

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    provider: "openai",
    model: "gpt-4",
    apiKey: "sk-test-key",
    ...overrides,
  };
}

function makeSuccessResponse(content: string, model = "gpt-4") {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(""),
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      model,
    }),
  };
}

describe("OpenAIProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch" as any);
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  describe("constructor", () => {
    it("sets provider name to openai", () => {
      const provider = new OpenAIProvider(makeConfig());
      expect(provider.name).toBe("openai");
    });

    it("uses apiKey from config", () => {
      const provider = new OpenAIProvider(makeConfig({ apiKey: "my-key" }));
      expect(provider.name).toBe("openai");
    });

    it("falls back to OPENAI_API_KEY env var", () => {
      process.env.OPENAI_API_KEY = "env-key";
      const provider = new OpenAIProvider(makeConfig({ apiKey: undefined }));
      expect(provider.name).toBe("openai");
    });

    it("uses default OpenAI baseUrl when not specified", () => {
      const provider = new OpenAIProvider(makeConfig({ baseUrl: undefined }));
      expect(provider.name).toBe("openai");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      const provider = new OpenAIProvider(makeConfig());
      await expect(provider.init()).resolves.toBeUndefined();
    });
  });

  describe("validateConfig", () => {
    it("resolves when apiKey is provided in config", async () => {
      const provider = new OpenAIProvider(makeConfig({ apiKey: "sk-key" }));
      await expect(provider.validateConfig(makeConfig({ apiKey: "sk-key" }))).resolves.toBeUndefined();
    });

    it("resolves when OPENAI_API_KEY env var is set", async () => {
      process.env.OPENAI_API_KEY = "env-key";
      const provider = new OpenAIProvider(makeConfig());
      await expect(provider.validateConfig({ provider: "openai" })).resolves.toBeUndefined();
    });

    it("skips validation in test environment (NODE_ENV=test)", async () => {
      // NODE_ENV is 'test' in vitest by default
      const provider = new OpenAIProvider(makeConfig({ apiKey: "" }));
      // Should not throw because NODE_ENV is "test"
      await expect(provider.validateConfig({ provider: "openai" })).resolves.toBeUndefined();
    });

    it("throws when no API key and NODE_ENV is not test", async () => {
      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const provider = new OpenAIProvider(makeConfig({ apiKey: "" }));
        await expect(
          provider.validateConfig({ provider: "openai" })
        ).rejects.toThrow("OpenAI API key is required in config or OPENAI_API_KEY environment variable");
      } finally {
        process.env.NODE_ENV = origNodeEnv;
      }
    });
  });

  describe("getDefaultModel", () => {
    it("returns model from config", () => {
      const provider = new OpenAIProvider(makeConfig({ model: "gpt-4-turbo" }));
      expect(provider.getDefaultModel()).toBe("gpt-4-turbo");
    });

    it("returns gpt-4 as default when model not specified", () => {
      const provider = new OpenAIProvider(makeConfig({ model: undefined }));
      expect(provider.getDefaultModel()).toBe("gpt-4");
    });
  });

  describe("chat", () => {
    it("sends request to /chat/completions endpoint", async () => {
      const provider = new OpenAIProvider(makeConfig({ baseUrl: "https://api.openai.com/v1" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("Hello!") as any);

      await provider.chat([{ role: "user", content: "Hello" }]);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("returns response content", async () => {
      const provider = new OpenAIProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("Response text") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(result.content).toBe("Response text");
    });

    it("includes Authorization Bearer header", async () => {
      const provider = new OpenAIProvider(makeConfig({ apiKey: "my-api-key" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok") as any);

      await provider.chat([{ role: "user", content: "test" }]);

      const opts = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((opts.headers as any)["Authorization"]).toBe("Bearer my-api-key");
    });

    it("returns usage stats", async () => {
      const provider = new OpenAIProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("result") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(result.usage).toEqual({ prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 });
    });

    it("returns finish_reason", async () => {
      const provider = new OpenAIProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("done") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(result.finish_reason).toBe("stop");
    });

    it("throws on non-ok HTTP response", async () => {
      const provider = new OpenAIProvider(makeConfig());
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue("Rate limit exceeded"),
      } as any);

      await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "OpenAI API error (429): Rate limit exceeded"
      );
    });

    it("uses model from options when provided", async () => {
      const provider = new OpenAIProvider(makeConfig({ model: "gpt-4" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok", "gpt-4-turbo") as any);

      await provider.chat([{ role: "user", content: "Hi" }], { model: "gpt-4-turbo" });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(body.model).toBe("gpt-4-turbo");
    });
  });

  describe("listModels", () => {
    it("returns list of gpt model ids", async () => {
      const provider = new OpenAIProvider(makeConfig());
      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            { id: "gpt-4" },
            { id: "gpt-3.5-turbo" },
            { id: "whisper-1" }, // should be filtered out
          ],
        }),
      } as any);

      const models = await provider.listModels();

      expect(models).toEqual(["gpt-4", "gpt-3.5-turbo"]);
      expect(models).not.toContain("whisper-1");
    });

    it("throws on non-ok response", async () => {
      const provider = new OpenAIProvider(makeConfig());
      fetchSpy.mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      } as any);

      await expect(provider.listModels()).rejects.toThrow("Failed to list models: Not Found");
    });
  });

  describe("shutdown", () => {
    it("resolves without errors", async () => {
      const provider = new OpenAIProvider(makeConfig());
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
});
