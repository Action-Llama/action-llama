import { describe, it, expect, vi, beforeEach } from "vitest";
import { sshUrl } from "../../src/shared/git.js";

// We only test sshUrl (pure). gitExec uses execSync which we'd need to mock,
// but it's a thin wrapper that gets exercised through command tests.

describe("sshUrl", () => {
  it("returns ssh git URL", () => {
    expect(sshUrl("octocat", "hello-world")).toBe("git@github.com:octocat/hello-world.git");
  });
});
