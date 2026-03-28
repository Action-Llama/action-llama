import { describe, it, expect } from "vitest";
import {
  resolveCredential,
  getBuiltinCredential,
  listBuiltinCredentialIds,
} from "../../src/credentials/registry.js";

describe("resolveCredential", () => {
  it("returns a credential definition for a known built-in ID", () => {
    const def = resolveCredential("github_token");
    expect(def.id).toBe("github_token");
    expect(typeof def.label).toBe("string");
    expect(Array.isArray(def.fields)).toBe(true);
  });

  it("returns definition for anthropic_key", () => {
    const def = resolveCredential("anthropic_key");
    expect(def.id).toBe("anthropic_key");
  });

  it("throws for an unknown credential ID", () => {
    expect(() => resolveCredential("not_a_real_credential")).toThrow(
      /Unknown credential "not_a_real_credential"/
    );
  });

  it("throws with a descriptive error message listing available credentials", () => {
    expect(() => resolveCredential("unknown_id")).toThrow(/Unknown credential/);
  });
});

describe("getBuiltinCredential", () => {
  it("returns the definition for a known credential ID", () => {
    const def = getBuiltinCredential("github_token");
    expect(def).toBeDefined();
    expect(def!.id).toBe("github_token");
  });

  it("returns undefined for an unknown ID", () => {
    const def = getBuiltinCredential("does_not_exist");
    expect(def).toBeUndefined();
  });

  it("returns linear_token definition", () => {
    const def = getBuiltinCredential("linear_token");
    expect(def).toBeDefined();
    expect(def!.id).toBe("linear_token");
  });
});

describe("listBuiltinCredentialIds", () => {
  it("returns a non-empty array of credential IDs", () => {
    const ids = listBuiltinCredentialIds();
    expect(ids.length).toBeGreaterThan(0);
  });

  it("includes well-known credential types", () => {
    const ids = listBuiltinCredentialIds();
    expect(ids).toContain("github_token");
    expect(ids).toContain("anthropic_key");
    expect(ids).toContain("openai_key");
  });

  it("returns only strings", () => {
    const ids = listBuiltinCredentialIds();
    for (const id of ids) {
      expect(typeof id).toBe("string");
    }
  });
});
