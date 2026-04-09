import { describe, expect, it } from "vitest";
import { extractTurnEndError } from "../../src/agents/turn-end-error.js";

describe("extractTurnEndError", () => {
  it("returns undefined for null, primitives, and empty records", () => {
    expect(extractTurnEndError(undefined)).toBeUndefined();
    expect(extractTurnEndError(null)).toBeUndefined();
    expect(extractTurnEndError("boom")).toBeUndefined();
    expect(extractTurnEndError(42)).toBeUndefined();
    expect(extractTurnEndError({})).toBeUndefined();
  });

  it("returns the first non-empty string candidate in priority order", () => {
    expect(
      extractTurnEndError({
        errorMessage: "  primary error  ",
        error_message: "secondary error",
        error: "tertiary error",
        message: "fallback error",
      }),
    ).toBe("primary error");

    expect(
      extractTurnEndError({
        errorMessage: "   ",
        error_message: "  snake_case error  ",
        error: "tertiary error",
        message: "fallback error",
      }),
    ).toBe("snake_case error");

    expect(
      extractTurnEndError({
        errorMessage: "",
        error_message: "   ",
        error: " direct error ",
        message: "fallback error",
      }),
    ).toBe("direct error");

    expect(
      extractTurnEndError({
        errorMessage: "",
        error_message: "   ",
        error: "",
        message: " final message ",
      }),
    ).toBe("final message");
  });

  it("recurses into nested result objects until it finds an error", () => {
    expect(
      extractTurnEndError({
        result: {
          result: {
            error_message: " nested failure ",
          },
        },
      }),
    ).toBe("nested failure");
  });

  it("returns undefined when result is present but not an object", () => {
    expect(extractTurnEndError({ result: "boom" })).toBeUndefined();
    expect(extractTurnEndError({ result: 0 })).toBeUndefined();
    expect(extractTurnEndError({ result: false })).toBeUndefined();
  });
});
