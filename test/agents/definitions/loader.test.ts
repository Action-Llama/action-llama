import { describe, it, expect } from "vitest";
import { loadDefinition, loadDefinitionAgentsMd, listBuiltinDefinitions, isBuiltinDefinition } from "../../../src/agents/definitions/loader.js";

describe("loadDefinition", () => {
  it("loads dev definition", () => {
    const def = loadDefinition("dev");
    expect(def.name).toBe("dev");
    expect(def.label).toBe("Developer agent");
    expect(def.params.triggerLabel).toBeDefined();
    expect(def.params.assignee).toBeDefined();
  });

  it("loads reviewer definition", () => {
    const def = loadDefinition("reviewer");
    expect(def.name).toBe("reviewer");
    expect(Object.keys(def.params)).toHaveLength(0);
  });

  it("loads devops definition", () => {
    const def = loadDefinition("devops");
    expect(def.name).toBe("devops");
    expect(def.credentials.optional).toContain("sentry-token");
    expect(def.params.sentryOrg).toBeDefined();
    expect(def.params.sentryOrg.credential).toBe("sentry-token");
  });

  it("throws for unknown name", () => {
    expect(() => loadDefinition("nonexistent")).toThrow("Agent definition not found");
  });

  it("validates the loaded JSON", () => {
    // All built-in definitions should pass validation
    for (const name of ["dev", "reviewer", "devops"]) {
      expect(() => loadDefinition(name)).not.toThrow();
    }
  });
});

describe("loadDefinitionAgentsMd", () => {
  it("loads dev AGENTS.md", () => {
    const md = loadDefinitionAgentsMd("dev");
    expect(md).toContain("Developer Agent");
  });

  it("loads reviewer AGENTS.md", () => {
    const md = loadDefinitionAgentsMd("reviewer");
    expect(md).toContain("PR Reviewer Agent");
  });

  it("loads devops AGENTS.md", () => {
    const md = loadDefinitionAgentsMd("devops");
    expect(md).toContain("DevOps Agent");
  });

  it("throws for unknown name", () => {
    expect(() => loadDefinitionAgentsMd("nonexistent")).toThrow("AGENTS.md");
  });
});

describe("listBuiltinDefinitions", () => {
  it("returns all three built-in definitions", () => {
    const defs = listBuiltinDefinitions();
    expect(defs).toHaveLength(3);
    const names = defs.map((d) => d.name);
    expect(names).toContain("dev");
    expect(names).toContain("reviewer");
    expect(names).toContain("devops");
  });
});

describe("isBuiltinDefinition", () => {
  it("returns true for built-in names", () => {
    expect(isBuiltinDefinition("dev")).toBe(true);
    expect(isBuiltinDefinition("reviewer")).toBe(true);
    expect(isBuiltinDefinition("devops")).toBe(true);
  });

  it("returns false for unknown names", () => {
    expect(isBuiltinDefinition("custom")).toBe(false);
  });
});
