import type { IncomingMessage, ServerResponse } from "http";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  private compile(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const parts = path.split("/").map((part) => {
      if (part.startsWith(":")) {
        paramNames.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    return { pattern: new RegExp(`^${parts.join("/")}$`), paramNames };
  }

  get(path: string, handler: RouteHandler): void {
    const { pattern, paramNames } = this.compile(path);
    this.routes.push({ method: "GET", pattern, paramNames, handler });
  }

  post(path: string, handler: RouteHandler): void {
    const { pattern, paramNames } = this.compile(path);
    this.routes.push({ method: "POST", pattern, paramNames, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      await route.handler(req, res, params);
      return true;
    }

    return false;
  }
}

export function readBody(req: IncomingMessage, maxSizeMb = 10): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = maxSizeMb * 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error(`Request body too large (>${maxSizeMb}MB)`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}
