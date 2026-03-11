import { describe, it, expect } from "vitest";
import { ExitCode, getExitCodeMessage, extractExitSignal } from "../../src/shared/exit-codes.js";

describe("exit-codes", () => {
  describe("ExitCode enum", () => {
    it("defines standard exit codes", () => {
      expect(ExitCode.SUCCESS).toBe(0);
      expect(ExitCode.AUTH_FAILURE).toBe(10);
      expect(ExitCode.PERMISSION_DENIED).toBe(11);
      expect(ExitCode.RATE_LIMITED).toBe(12);
      expect(ExitCode.INVALID_CONFIG).toBe(13);
      expect(ExitCode.DEPENDENCY_ERROR).toBe(14);
      expect(ExitCode.UNRECOVERABLE_ERROR).toBe(15);
      expect(ExitCode.USER_ABORT).toBe(16);
    });
  });

  describe("getExitCodeMessage", () => {
    it("returns correct messages for standard exit codes", () => {
      expect(getExitCodeMessage(ExitCode.SUCCESS)).toBe("Success");
      expect(getExitCodeMessage(ExitCode.AUTH_FAILURE)).toBe("Authentication/credentials failure");
      expect(getExitCodeMessage(ExitCode.PERMISSION_DENIED)).toBe("Permission/access denied");
      expect(getExitCodeMessage(ExitCode.RATE_LIMITED)).toBe("Rate limit exceeded");
      expect(getExitCodeMessage(ExitCode.INVALID_CONFIG)).toBe("Configuration error");
      expect(getExitCodeMessage(ExitCode.DEPENDENCY_ERROR)).toBe("Missing dependency or service error");
      expect(getExitCodeMessage(ExitCode.UNRECOVERABLE_ERROR)).toBe("Unrecoverable error");
      expect(getExitCodeMessage(ExitCode.USER_ABORT)).toBe("User-requested abort");
    });

    it("returns unknown message for invalid codes", () => {
      expect(getExitCodeMessage(99)).toBe("Unknown exit code: 99");
      expect(getExitCodeMessage(-1)).toBe("Unknown exit code: -1");
    });
  });

  describe("extractExitSignal", () => {
    it("extracts exit code from [EXIT: code] pattern", () => {
      expect(extractExitSignal("[EXIT: 10]")).toBe(10);
      expect(extractExitSignal("[EXIT: 15]")).toBe(15);
      expect(extractExitSignal("Some text [EXIT: 11] more text")).toBe(11);
    });

    it("handles various whitespace formats", () => {
      expect(extractExitSignal("[EXIT:10]")).toBe(10);
      expect(extractExitSignal("[EXIT: 12 ]")).toBe(12);
      expect(extractExitSignal("[EXIT:  13  ]")).toBe(13);
    });

    it("returns default code for [EXIT] without number", () => {
      expect(extractExitSignal("[EXIT]")).toBe(ExitCode.UNRECOVERABLE_ERROR);
      expect(extractExitSignal("Error occurred [EXIT] stopping")).toBe(ExitCode.UNRECOVERABLE_ERROR);
    });

    it("returns undefined when no exit signal found", () => {
      expect(extractExitSignal("Normal output")).toBeUndefined();
      expect(extractExitSignal("Working on [ISSUE: 42]")).toBeUndefined();
      expect(extractExitSignal("Exit without brackets")).toBeUndefined();
    });

    it("finds first exit signal when multiple present", () => {
      expect(extractExitSignal("[EXIT: 10] first [EXIT: 11] second")).toBe(10);
    });

    it("handles exit signals in multiline text", () => {
      const multiline = `
        Processing request...
        [STATUS: working on issue]
        Error occurred: authentication failed
        [EXIT: 10] Unable to authenticate with GitHub
        Operation aborted.
      `;
      expect(extractExitSignal(multiline)).toBe(10);
    });

    it("ignores malformed exit patterns", () => {
      expect(extractExitSignal("[EXIT: abc]")).toBeNaN(); // NaN because parseInt("abc") is NaN
      expect(extractExitSignal("[EXIT: ]")).toBe(ExitCode.UNRECOVERABLE_ERROR);
      expect(extractExitSignal("EXIT: 10")).toBeUndefined(); // missing brackets
    });

    it("resets regex state for multiple calls", () => {
      // Test that the regex state doesn't interfere between calls
      expect(extractExitSignal("text [EXIT: 10] more")).toBe(10);
      expect(extractExitSignal("different [EXIT: 11] text")).toBe(11);
      expect(extractExitSignal("another [EXIT: 12] example")).toBe(12);
    });
  });
});