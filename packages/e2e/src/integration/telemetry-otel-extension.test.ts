/**
 * Integration tests: telemetry/providers/otel.ts — no Docker required.
 *
 * telemetry/providers/otel.ts exports the `otelExtension` TelemetryExtension
 * object and the `OTelProvider` class. The extension object wraps the OTel
 * SDK configuration with metadata and lifecycle methods.
 *
 * Note: OTelProvider.init() starts the OpenTelemetry NodeSDK which may attempt
 * to connect to an OTLP collector. We test the extension metadata and the
 * no-op/graceful-error paths only.
 *
 * Test scenarios (no Docker required):
 *   1. otelExtension is defined
 *   2. otelExtension metadata.name is 'otel'
 *   3. otelExtension metadata.type is 'telemetry'
 *   4. otelExtension metadata.version is defined
 *   5. otelExtension metadata.description is non-empty
 *   6. otelExtension metadata.requiredCredentials includes otel_endpoint
 *   7. otelExtension metadata.requiredCredentials includes optional otel_api_key
 *   8. otelExtension metadata.providesCredentialTypes includes otel_endpoint
 *   9. otelExtension metadata.providesCredentialTypes includes otel_api_key
 *  10. otelExtension provider is defined
 *  11. otelExtension init() does not throw (no-op path)
 *  12. otelExtension shutdown() does not throw
 *
 * Covers:
 *   - telemetry/providers/otel.ts: otelExtension — all metadata fields
 *   - telemetry/providers/otel.ts: otelExtension — init() no-op
 *   - telemetry/providers/otel.ts: otelExtension — shutdown() delegates to provider
 *   - telemetry/providers/otel.ts: OTelProvider constructor
 */

import { describe, it, expect } from "vitest";

const {
  otelExtension,
  OTelProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/telemetry/providers/otel.js"
);

describe("integration: telemetry/providers/otel.ts (no Docker required)", { timeout: 30_000 }, () => {

  // ── otelExtension metadata ────────────────────────────────────────────────

  it("otelExtension is defined", () => {
    expect(otelExtension).toBeDefined();
  });

  it("metadata.name is 'otel'", () => {
    expect(otelExtension.metadata.name).toBe("otel");
  });

  it("metadata.type is 'telemetry'", () => {
    expect(otelExtension.metadata.type).toBe("telemetry");
  });

  it("metadata.version is defined", () => {
    expect(typeof otelExtension.metadata.version).toBe("string");
  });

  it("metadata.description is non-empty", () => {
    expect(otelExtension.metadata.description).toBeTruthy();
  });

  it("metadata.requiredCredentials includes otel_endpoint", () => {
    const creds = otelExtension.metadata.requiredCredentials || [];
    expect(creds.some((c: any) => c.type === "otel_endpoint")).toBe(true);
  });

  it("metadata.requiredCredentials otel_api_key is optional", () => {
    const creds = otelExtension.metadata.requiredCredentials || [];
    const apiKey = creds.find((c: any) => c.type === "otel_api_key");
    expect(apiKey).toBeDefined();
    expect(apiKey.optional).toBe(true);
  });

  it("metadata.providesCredentialTypes includes otel_endpoint", () => {
    const types = otelExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "otel_endpoint")).toBe(true);
  });

  it("metadata.providesCredentialTypes includes otel_api_key", () => {
    const types = otelExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "otel_api_key")).toBe(true);
  });

  // ── otelExtension lifecycle ───────────────────────────────────────────────

  it("provider is defined", () => {
    expect(otelExtension.provider).toBeDefined();
  });

  it("init() does not throw (no-op path)", async () => {
    await expect(otelExtension.init(undefined)).resolves.toBeUndefined();
  });

  it("shutdown() does not throw", async () => {
    await expect(otelExtension.shutdown()).resolves.toBeUndefined();
  });

  // ── OTelProvider class ────────────────────────────────────────────────────

  it("OTelProvider can be constructed without throwing", () => {
    expect(() => new OTelProvider({ enabled: false, provider: "otel" })).not.toThrow();
  });

  it("OTelProvider shutdown() does not throw when not initialized", async () => {
    const provider = new OTelProvider({ enabled: false, provider: "otel" });
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});
