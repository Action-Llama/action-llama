import { describe, it, expect } from "vitest";
import { ExitCode, getExitCodeMessage } from "../../src/shared/exit-codes.js";

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
});
