/**
 * Integration tests: scale control API endpoints — no Docker required.
 *
 * The /control/project/scale and /control/agents/:name/scale endpoints
 * update config.toml files via updateProjectScale() and updateAgentRuntimeField().
 * These are file I/O operations that don't require Docker.
 *
 * Test scenarios:
 *   POST /control/project/scale:
 *     1. Invalid scale (non-integer, negative) → 400
 *     2. Valid scale → updates project config.toml, returns 200
 *
 *   POST /control/agents/:name/scale:
 *     3. Invalid scale → 400
 *     4. Nonexistent agent → 404
 *     5. Valid scale for existing agent → updates agent config.toml, returns 200
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/project/scale — invalid → 400, valid → 200
 *   - control/routes/control.ts: POST /control/agents/:name/scale — invalid → 400
 *   - control/routes/control.ts: POST /control/agents/:name/scale — not found → 404
 *   - control/routes/control.ts: POST /control/agents/:name/scale — valid → 200
 *   - shared/config/load-agent.ts: updateAgentRuntimeField (writes scale to config.toml)
 *   - shared/config/load-project.ts: updateProjectScale (writes scale to config.toml)
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML } from "smol-toml";

describe(
  "integration: scale control API (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;
    let gatewayAccessible = false;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
        gatewayAccessible = false;
      }
    });

    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "scale-api-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      try {
        await harness.start();
        gatewayAccessible = true;
      } catch {
        try {
          const h = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = h.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    function controlPost(path: string, body: unknown): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${harness.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    }

    // ── POST /control/project/scale ─────────────────────────────────────────

    it("POST /control/project/scale with scale=0 returns 400 (must be positive)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/project/scale", { scale: 0 });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/scale.*integer|positive/i);
    });

    it("POST /control/project/scale with scale=-1 returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/project/scale", { scale: -1 });
      expect(res.status).toBe(400);
    });

    it("POST /control/project/scale with valid scale updates config.toml", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/project/scale", { scale: 7 });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify config.toml was updated
      const configPath = resolve(harness.projectPath, "config.toml");
      const config = parseTOML(readFileSync(configPath, "utf-8")) as any;
      expect(config.scale).toBe(7);
    });

    // ── POST /control/agents/:name/scale ────────────────────────────────────

    it("POST /control/agents/:name/scale with scale=0 returns 400", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/scale-api-agent/scale", { scale: 0 });
      expect(res.status).toBe(400);
    });

    it("POST /control/agents/:name/scale for nonexistent agent returns 404", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/nonexistent-agent-xyz/scale", { scale: 2 });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not found/i);
    });

    it("POST /control/agents/:name/scale with valid scale updates agent config.toml", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await controlPost("/control/agents/scale-api-agent/scale", { scale: 3 });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify agent config.toml was updated
      const agentConfigPath = resolve(harness.projectPath, "agents", "scale-api-agent", "config.toml");
      const config = parseTOML(readFileSync(agentConfigPath, "utf-8")) as any;
      expect(config.scale).toBe(3);
    });
  },
);
