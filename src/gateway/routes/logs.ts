import type { Router } from "../router.js";
import { readBody, sendJson, sendError } from "../router.js";
import type { ContainerRegistration } from "../types.js";
import type { Logger } from "../../shared/logger.js";

export function registerLogRoute(
  router: Router,
  containerRegistry: Map<string, ContainerRegistration>,
  logger: Logger
): void {
  router.post("/logs/:secret", async (req, res, params) => {
    const reg = containerRegistry.get(params.secret);
    if (!reg) {
      sendError(res, 403, "invalid secret");
      return;
    }

    if (!reg.onLogLine) {
      sendJson(res, 200, { ok: true, forwarded: 0 });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch {
      sendError(res, 400, "failed to read request body");
      return;
    }

    let forwarded = 0;
    for (const line of body.split("\n")) {
      if (line.trim()) {
        reg.onLogLine(line);
        forwarded++;
      }
    }

    sendJson(res, 200, { ok: true, forwarded });
  });
}
