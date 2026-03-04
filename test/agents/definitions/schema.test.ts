import { describe, it, expect } from "vitest";
import { validateDefinition } from "../../../src/agents/definitions/schema.js";

const validDef = {
  name: "test",
  label: "Test agent",
  description: "A test agent",
  credentials: { required: ["github-token"], optional: [] },
  params: {},
};

describe("validateDefinition", () => {
  it("accepts a valid minimal definition", () => {
    const result = validateDefinition(validDef);
    expect(result.name).toBe("test");
    expect(result.label).toBe("Test agent");
  });

  it("accepts a definition with params", () => {
    const result = validateDefinition({
      ...validDef,
      params: {
        myParam: {
          type: "string",
          description: "A param",
          default: "val",
          required: true,
        },
        listParam: {
          type: "string[]",
          description: "A list param",
          required: false,
        },
      },
    });
    expect(Object.keys(result.params)).toEqual(["myParam", "listParam"]);
  });

  it("accepts a param with credential", () => {
    const result = validateDefinition({
      ...validDef,
      params: {
        org: {
          type: "string",
          description: "Org slug",
          required: false,
          credential: "sentry-token",
        },
      },
    });
    expect(result.params.org.credential).toBe("sentry-token");
  });

  it("rejects null", () => {
    expect(() => validateDefinition(null)).toThrow("non-null object");
  });

  it("rejects missing name", () => {
    const { name, ...rest } = validDef;
    expect(() => validateDefinition(rest)).toThrow("'name'");
  });

  it("accepts definition without label and description", () => {
    const { label, description, ...minimal } = validDef;
    const result = validateDefinition(minimal);
    expect(result.name).toBe("test");
    expect(result.label).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it("rejects missing credentials", () => {
    const { credentials, ...rest } = validDef;
    expect(() => validateDefinition(rest)).toThrow("'credentials'");
  });

  it("rejects invalid param type", () => {
    expect(() =>
      validateDefinition({
        ...validDef,
        params: { bad: { type: "number", description: "x", required: true } },
      })
    ).toThrow('Param "bad" type');
  });

  it("rejects param without required field", () => {
    expect(() =>
      validateDefinition({
        ...validDef,
        params: { bad: { type: "string", description: "x" } },
      })
    ).toThrow('Param "bad" must have a boolean');
  });
});
