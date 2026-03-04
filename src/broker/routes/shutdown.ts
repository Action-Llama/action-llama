import { execFileSync } from "child_process";
import type { Router } from "../router.js";
import { readBody, sendJson, sendError } from "../router.js";
import type { Logger } from "../../shared/logger.js";

export function registerShutdownRoute(
  router: Router,
  containerSecrets: Map<string, string>,
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

    const containerName = containerSecrets.get(secret);
    if (!containerName) {
      sendError(res, 403, "invalid secret");
      return;
    }

    logger.error(
      { container: containerName, reason, details },
      "shutdown requested — killing container"
    );

    try {
      execFileSync("docker", ["kill", containerName], {
        encoding: "utf-8",
        timeout: 10000,
      });
    } catch {
      // Container may already be dead
    }

    containerSecrets.delete(secret);
    sendJson(res, 200, { killed: true, container: containerName });
  });
}
