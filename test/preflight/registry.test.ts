import { describe, it, expect } from "vitest";
import { resolvePreflightProvider, listPreflightProviders } from "../../src/preflight/registry.js";

describe("resolvePreflightProvider", () => {
  it("resolves shell provider", () => {
    const p = resolvePreflightProvider("shell");
    expect(p.id).toBe("shell");
  });

  it("resolves http provider", () => {
    const p = resolvePreflightProvider("http");
    expect(p.id).toBe("http");
  });

  it("resolves git-clone provider", () => {
    const p = resolvePreflightProvider("git-clone");
    expect(p.id).toBe("git-clone");
  });

  it("throws for unknown provider", () => {
    expect(() => resolvePreflightProvider("ftp")).toThrow(
      /Unknown preflight provider "ftp"/,
    );
  });
});

describe("listPreflightProviders", () => {
  it("returns all built-in provider ids", () => {
    const ids = listPreflightProviders();
    expect(ids).toContain("shell");
    expect(ids).toContain("http");
    expect(ids).toContain("git-clone");
  });
});
