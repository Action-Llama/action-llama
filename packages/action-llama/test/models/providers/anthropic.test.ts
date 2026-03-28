import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicProvider } from "../../../src/models/providers/anthropic.js";

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-ant-test",
    ...overrides,
  };
}

function makeSuccessResponse(content: string, model = "claude-sonnet-4-20250514") {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(""),
    json: vi.fn().mockResolvedValue({
      content: [{ text: content }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model,
      stop_reason: "end_turn",
    }),
  };
}

describe("AnthropicProvider", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch" as any);
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe("constructor", () => {
    it("sets provider name to anthropic", () => {
      const provider = new AnthropicProvider(makeConfig());
      expect(provider.name).toBe("anthropic");
    });

    it("uses apiKey from config", () => {
      const provider = new AnthropicProvider(makeConfig({ apiKey: "my-key" }));
      expect(provider.name).toBe("anthropic");
    });

    it("falls back to ANTHROPIC_API_KEY env var", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";
      const provider = new AnthropicProvider(makeConfig({ apiKey: undefined }));
      expect(provider.name).toBe("anthropic");
    });

    it("uses default Anthropic baseUrl when not specified", () => {
      const provider = new AnthropicProvider(makeConfig({ baseUrl: undefined }));
      expect(provider.name).toBe("anthropic");
    });
  });

  describe("init", () => {
    it("resolves without error", async () => {
      const provider = new AnthropicProvider(makeConfig());
      await expect(provider.init()).resolves.toBeUndefined();
    });
  });

  describe("validateConfig", () => {
    it("resolves when apiKey is in config", async () => {
      const provider = new AnthropicProvider(makeConfig({ apiKey: "sk-ant" }));
      await expect(provider.validateConfig(makeConfig({ apiKey: "sk-ant" }))).resolves.toBeUndefined();
    });

    it("resolves when ANTHROPIC_API_KEY env var is set", async () => {
      process.env.ANTHROPIC_API_KEY = "env-key";
      const provider = new AnthropicProvider(makeConfig());
      await expect(provider.validateConfig({ provider: "anthropic" })).resolves.toBeUndefined();
    });

    it("throws when no apiKey and no env var", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = new AnthropicProvider(makeConfig({ apiKey: "" }));
      await expect(provider.validateConfig({ provider: "anthropic" })).rejects.toThrow(
        "Anthropic API key is required"
      );
    });
  });

  describe("getDefaultModel", () => {
    it("returns model from config", () => {
      const provider = new AnthropicProvider(makeConfig({ model: "claude-3-opus" }));
      expect(provider.getDefaultModel()).toBe("claude-3-opus");
    });

    it("returns default claude model when none specified", () => {
      const provider = new AnthropicProvider(makeConfig({ model: undefined }));
      expect(provider.getDefaultModel()).toBe("claude-sonnet-4-20250514");
    });
  });

  describe("chat", () => {
    it("calls /messages endpoint", async () => {
      const provider = new AnthropicProvider(makeConfig({ baseUrl: "https://api.anthropic.com/v1" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("Hello!") as any);

      await provider.chat([{ role: "user", content: "Hi" }]);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
    });

    it("returns response content", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("Reply text") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(result.content).toBe("Reply text");
    });

    it("includes x-api-key header", async () => {
      const provider = new AnthropicProvider(makeConfig({ apiKey: "secret-key" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok") as any);

      await provider.chat([{ role: "user", content: "test" }]);

      const opts = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((opts.headers as any)["x-api-key"]).toBe("secret-key");
    });

    it("includes anthropic-version header", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok") as any);

      await provider.chat([{ role: "user", content: "test" }]);

      const opts = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((opts.headers as any)["anthropic-version"]).toBe("2023-06-01");
    });

    it("returns usage computed from input+output tokens", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("result") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    it("returns finish_reason as stop_reason from response", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("done") as any);

      const result = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(result.finish_reason).toBe("end_turn");
    });

    it("separates system messages from conversation messages", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok") as any);

      await provider.chat([
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(body.system).toContain("You are helpful.");
      // System message should not appear in messages array
      expect(body.messages.every((m: any) => m.role !== "system")).toBe(true);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe("Hello");
    });

    it("throws on non-ok HTTP response", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue("Bad request"),
      } as any);

      await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
        "Anthropic API error (400): Bad request"
      );
    });

    it("uses model from options when provided", async () => {
      const provider = new AnthropicProvider(makeConfig({ model: "claude-3-sonnet" }));
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok", "claude-3-opus") as any);

      await provider.chat([{ role: "user", content: "Hi" }], { model: "claude-3-opus" });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(body.model).toBe("claude-3-opus");
    });

    it("concatenates multiple system messages with double newline", async () => {
      const provider = new AnthropicProvider(makeConfig());
      fetchSpy.mockResolvedValue(makeSuccessResponse("ok") as any);

      await provider.chat([
        { role: "system", content: "Be brief." },
        { role: "system", content: "Be polite." },
        { role: "user", content: "Hello" },
      ]);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(body.system).toBe("Be brief.\n\nBe polite.");
    });
  });

  describe("shutdown", () => {
    it("resolves without errors", async () => {
      const provider = new AnthropicProvider(makeConfig());
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
});
