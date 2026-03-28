import { describe, it, expect } from "vitest";
import {
  resolveWebhookDefinition,
  listWebhookDefinitions,
} from "../../../src/webhooks/definitions/registry.js";

describe("resolveWebhookDefinition", () => {
  it("returns the github definition for id 'github'", () => {
    const def = resolveWebhookDefinition("github");
    expect(def.id).toBe("github");
    expect(def.label).toBe("GitHub");
  });

  it("returns the sentry definition for id 'sentry'", () => {
    const def = resolveWebhookDefinition("sentry");
    expect(def.id).toBe("sentry");
  });

  it("returns the discord definition for id 'discord'", () => {
    const def = resolveWebhookDefinition("discord");
    expect(def.id).toBe("discord");
  });

  it("returns the slack definition for id 'slack'", () => {
    const def = resolveWebhookDefinition("slack");
    expect(def.id).toBe("slack");
  });

  it("returns the twitter definition for id 'twitter'", () => {
    const def = resolveWebhookDefinition("twitter");
    expect(def.id).toBe("twitter");
  });

  it("throws for an unknown definition ID", () => {
    expect(() => resolveWebhookDefinition("unknown_source")).toThrow(
      /Unknown webhook definition: "unknown_source"/
    );
  });

  it("error message includes the list of available IDs", () => {
    try {
      resolveWebhookDefinition("bad_id");
      expect.fail("expected an error");
    } catch (e: any) {
      expect(e.message).toMatch(/Available:/);
      expect(e.message).toContain("github");
    }
  });
});

describe("listWebhookDefinitions", () => {
  it("returns all definitions as an array", () => {
    const defs = listWebhookDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });

  it("includes all built-in definitions", () => {
    const ids = listWebhookDefinitions().map((d) => d.id);
    expect(ids).toContain("github");
    expect(ids).toContain("sentry");
    expect(ids).toContain("discord");
    expect(ids).toContain("slack");
    expect(ids).toContain("twitter");
  });

  it("returns a copy (mutating the result does not affect subsequent calls)", () => {
    const first = listWebhookDefinitions();
    first.push({ id: "fake", label: "Fake", description: "test", filterSpec: [] });
    const second = listWebhookDefinitions();
    expect(second.find((d) => d.id === "fake")).toBeUndefined();
  });
});
