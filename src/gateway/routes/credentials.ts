import type { Router } from "../router.js";
import { sendJson, sendError } from "../router.js";
import type { ContainerRegistration } from "../types.js";
import type { Logger } from "../../shared/logger.js";

export function registerCredentialRoute(
  router: Router,
  containerRegistry: Map<string, ContainerRegistration>,
  logger: Logger
): void {
  router.get("/credentials/:secret", async (_req, res, params) => {
    const reg = containerRegistry.get(params.secret);
    if (!reg) {
      sendError(res, 403, "invalid secret");
      return;
    }

    if (!reg.credentials) {
      sendError(res, 404, "no credentials registered for this container");
      return;
    }

    logger.debug({ container: reg.containerName }, "serving credentials");
    sendJson(res, 200, reg.credentials);
  });
}
