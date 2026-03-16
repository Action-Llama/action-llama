import { describe, it, expect } from "vitest";
import { interpolateString, interpolateParams } from "../../src/preflight/interpolate.js";

describe("interpolateString", () => {
  const env = { TOKEN: "abc123", HOST: "example.com", EMPTY: "" };

  it("replaces ${VAR} with env value", () => {
    expect(interpolateString("Bearer ${TOKEN}", env)).toBe("Bearer abc123");
  });

  it("replaces multiple vars", () => {
    expect(interpolateString("https://${HOST}/api?t=${TOKEN}", env)).toBe(
      "https://example.com/api?t=abc123",
    );
  });

  it("replaces missing vars with empty string", () => {
    expect(interpolateString("key=${MISSING}", env)).toBe("key=");
  });

  it("replaces empty var with empty string", () => {
    expect(interpolateString("key=${EMPTY}", env)).toBe("key=");
  });

  it("leaves strings without vars unchanged", () => {
    expect(interpolateString("plain text", env)).toBe("plain text");
  });

  it("does not expand $VAR (only ${VAR})", () => {
    expect(interpolateString("$TOKEN", env)).toBe("$TOKEN");
  });
});

describe("interpolateParams", () => {
  const env = { TOKEN: "secret", BASE: "https://api.test" };

  it("interpolates string values", () => {
    const result = interpolateParams({ url: "${BASE}/v1", auth: "Bearer ${TOKEN}" }, env);
    expect(result).toEqual({ url: "https://api.test/v1", auth: "Bearer secret" });
  });

  it("recurses into nested objects", () => {
    const result = interpolateParams(
      { headers: { Authorization: "Bearer ${TOKEN}" } },
      env,
    );
    expect(result).toEqual({ headers: { Authorization: "Bearer secret" } });
  });

  it("recurses into arrays", () => {
    const result = interpolateParams({ args: ["--token", "${TOKEN}"] }, env);
    expect(result).toEqual({ args: ["--token", "secret"] });
  });

  it("leaves numbers and booleans unchanged", () => {
    const result = interpolateParams({ depth: 1, verbose: true }, env);
    expect(result).toEqual({ depth: 1, verbose: true });
  });

  it("leaves null unchanged", () => {
    const result = interpolateParams({ value: null }, env);
    expect(result).toEqual({ value: null });
  });
});
