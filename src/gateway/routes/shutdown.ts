import type { Router } from "../router.js";
import { readBody, sendJson, sendError } from "../router.js";
import type { ContainerRegistration } from "../types.js";
import type { Logger } from "../../shared/logger.js";

export function registerShutdownRoute(
  router: Router,
  containerRegistry: Map<string, ContainerRegistration>,
  killContainer: (name: string) => Promise<void>,
  logger: Logger
): void {
  router.post("/shutdown", async (req, res) => {
    let body: { secret?: string; reason?: string; details?: string };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendError(res, 400, "invalid JSON body");
      return;
    }

    const { secret, reason, details } = body;
    if (!secret || typeof secret !== "string") {
      sendError(res, 400, "missing secret");
      return;
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      sendError(res, 403, "invalid secret");
      return;
    }

    logger.error(
      { container: reg.containerName, reason, details },
      "shutdown requested — killing container"
    );

    await killContainer(reg.containerName);

    containerRegistry.delete(secret);
    sendJson(res, 200, { killed: true, container: reg.containerName });
  });
}
