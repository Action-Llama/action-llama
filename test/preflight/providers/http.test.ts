import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { httpProvider } from "../../../src/preflight/providers/http.js";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PreflightContext } from "../../../src/preflight/schema.js";

let tmpDir: string;

function makeCtx(env?: Record<string, string>): PreflightContext {
  return {
    env: { ...env } as Record<string, string>,
    logger: () => {},
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "al-preflight-http-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("http provider", () => {
  it("fetches URL and writes to output", async () => {
    const body = JSON.stringify({ ok: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(body, { status: 200 }),
    );

    const output = join(tmpDir, "resp.json");
    await httpProvider.run(
      { url: "https://api.test/data", output },
      makeCtx(),
    );
    expect(readFileSync(output, "utf-8")).toBe(body);
  });

  it("passes headers and method", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("ok", { status: 200 }),
    );

    const output = join(tmpDir, "resp.txt");
    await httpProvider.run(
      {
        url: "https://api.test/post",
        output,
        method: "POST",
        headers: { Authorization: "Bearer tok" },
        body: "payload",
      },
      makeCtx(),
    );

    expect(fetchSpy).toHaveBeenCalledWith("https://api.test/post", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: "payload",
    });
  });

  it("interpolates env vars in URL and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("ok", { status: 200 }),
    );

    const output = join(tmpDir, "resp.txt");
    await httpProvider.run(
      {
        url: "https://${HOST}/api",
        output,
        headers: { Authorization: "Bearer ${TOKEN}" },
      },
      makeCtx({ HOST: "example.com", TOKEN: "secret" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
      }),
    );
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );

    const output = join(tmpDir, "resp.txt");
    await expect(
      httpProvider.run({ url: "https://api.test/bad", output }, makeCtx()),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("throws on missing url", async () => {
    await expect(
      httpProvider.run({ output: "/tmp/x" }, makeCtx()),
    ).rejects.toThrow(/requires a 'url' param/);
  });

  it("throws on missing output", async () => {
    await expect(
      httpProvider.run({ url: "https://test" }, makeCtx()),
    ).rejects.toThrow(/requires an 'output' param/);
  });

  it("creates parent directories for output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("data", { status: 200 }),
    );

    const output = join(tmpDir, "sub", "dir", "resp.txt");
    await httpProvider.run(
      { url: "https://api.test", output },
      makeCtx(),
    );
    expect(readFileSync(output, "utf-8")).toBe("data");
  });
});
