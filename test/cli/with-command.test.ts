import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withCommand } from "../../src/cli/with-command.js";
import { ConfigError, CredentialError, AgentError } from "../../src/shared/errors.js";

describe("withCommand", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    delete process.env.DEBUG;
  });

  it("calls the wrapped function with arguments", async () => {
    const fn = vi.fn();
    const wrapped = withCommand(fn);
    await wrapped("a", "b");
    expect(fn).toHaveBeenCalledWith("a", "b");
  });

  it("does not catch when function succeeds", async () => {
    const wrapped = withCommand(async () => {});
    await wrapped();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("prints ConfigError with prefix", async () => {
    const wrapped = withCommand(async () => {
      throw new ConfigError("missing field");
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("Configuration error: missing field");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints CredentialError with prefix", async () => {
    const wrapped = withCommand(async () => {
      throw new CredentialError("no key");
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("Credential error: no key");
  });

  it("prints AgentError with prefix", async () => {
    const wrapped = withCommand(async () => {
      throw new AgentError("docker missing");
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("Agent error: docker missing");
  });

  it("prints generic Error with 'Error:' prefix", async () => {
    const wrapped = withCommand(async () => {
      throw new Error("something broke");
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("Error: something broke");
  });

  it("handles non-Error throws", async () => {
    const wrapped = withCommand(async () => {
      throw "string error";
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("Error: string error");
  });

  it("shows stack trace when DEBUG is set", async () => {
    process.env.DEBUG = "1";
    const wrapped = withCommand(async () => {
      throw new Error("debug me");
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    // First call: "Error: debug me", second call: stack trace
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const stackCall = errorSpy.mock.calls[1][0];
    expect(stackCall).toContain("debug me");
    expect(stackCall).toContain("at ");
  });

  it("does not show stack trace without DEBUG", async () => {
    const wrapped = withCommand(async () => {
      throw new Error("no debug");
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("shows cause for generic errors", async () => {
    const wrapped = withCommand(async () => {
      throw new Error("wrapper", { cause: "root cause" });
    });
    await expect(wrapped()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("Cause: root cause");
  });
});
