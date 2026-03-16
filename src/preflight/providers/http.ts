import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { PreflightProvider, PreflightContext } from "../schema.js";
import { interpolateString, interpolateParams } from "../interpolate.js";

export const httpProvider: PreflightProvider = {
  id: "http",

  async run(params: Record<string, unknown>, ctx: PreflightContext): Promise<void> {
    const resolved = interpolateParams(params, ctx.env);
    const url = resolved.url;
    if (typeof url !== "string" || !url) {
      throw new Error("http provider requires a 'url' param");
    }
    const output = resolved.output;
    if (typeof output !== "string" || !output) {
      throw new Error("http provider requires an 'output' param");
    }

    const method = (typeof resolved.method === "string" ? resolved.method : "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (resolved.headers && typeof resolved.headers === "object" && !Array.isArray(resolved.headers)) {
      for (const [k, v] of Object.entries(resolved.headers as Record<string, unknown>)) {
        if (typeof v === "string") headers[k] = v;
      }
    }
    const body = typeof resolved.body === "string" ? resolved.body : undefined;

    ctx.logger("info", "preflight http", { method, url: url.slice(0, 200) });

    const response = await fetch(url, { method, headers, body });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, buffer);
    ctx.logger("info", "preflight http output written", { path: output, bytes: buffer.length });
  },
};
