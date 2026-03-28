import { describe, it, expect } from "vitest";
import { VERSION, GIT_SHA, imageTags, CONSTANTS } from "../../src/shared/constants.js";

describe("VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});

describe("GIT_SHA", () => {
  it("is a non-empty string", () => {
    expect(typeof GIT_SHA).toBe("string");
    expect(GIT_SHA.length).toBeGreaterThan(0);
  });
});

describe("imageTags", () => {
  it("returns an array with primary tag (git SHA), version tag, and latest", () => {
    const tags = imageTags("my-image");
    expect(tags).toHaveLength(3);
    expect(tags[0]).toMatch(/^my-image:/);
    expect(tags[1]).toBe(`my-image:${VERSION}`);
    expect(tags[2]).toBe("my-image:latest");
  });

  it("primary tag contains the GIT_SHA", () => {
    const tags = imageTags("al-agent");
    expect(tags[0]).toBe(`al-agent:${GIT_SHA}`);
  });
});

describe("CONSTANTS", () => {
  describe("static fields", () => {
    it("DEFAULT_SECRET_PREFIX is 'action-llama'", () => {
      expect(CONSTANTS.DEFAULT_SECRET_PREFIX).toBe("action-llama");
    });

    it("STARTED_BY is 'action-llama'", () => {
      expect(CONSTANTS.STARTED_BY).toBe("action-llama");
    });

    it("CONTAINER_FILTER is 'al-'", () => {
      expect(CONSTANTS.CONTAINER_FILTER).toBe("al-");
    });

    it("NETWORK_NAME is 'al-net'", () => {
      expect(CONSTANTS.NETWORK_NAME).toBe("al-net");
    });

    it("DEFAULT_IMAGE includes GIT_SHA", () => {
      expect(CONSTANTS.DEFAULT_IMAGE).toBe(`al-agent:${GIT_SHA}`);
    });

    it("PROJECT_BASE_IMAGE includes GIT_SHA", () => {
      expect(CONSTANTS.PROJECT_BASE_IMAGE).toBe(`al-project-base:${GIT_SHA}`);
    });

    it("SCHEDULER_IMAGE includes GIT_SHA", () => {
      expect(CONSTANTS.SCHEDULER_IMAGE).toBe(`al-scheduler:${GIT_SHA}`);
    });

    it("CONTAINER_UID is 1000", () => {
      expect(CONSTANTS.CONTAINER_UID).toBe(1000);
    });

    it("CONTAINER_GID is 1000", () => {
      expect(CONSTANTS.CONTAINER_GID).toBe(1000);
    });
  });

  describe("agentFamily", () => {
    it("prefixes agent name with 'al-'", () => {
      expect(CONSTANTS.agentFamily("my-agent")).toBe("al-my-agent");
    });

    it("works with any string name", () => {
      expect(CONSTANTS.agentFamily("fix-bug")).toBe("al-fix-bug");
    });
  });

  describe("agentNameFromFamily", () => {
    it("strips the 'al-' prefix from a family name", () => {
      expect(CONSTANTS.agentNameFromFamily("al-my-agent")).toBe("my-agent");
    });

    it("returns the family as-is when it does not start with 'al-'", () => {
      expect(CONSTANTS.agentNameFromFamily("my-agent")).toBe("my-agent");
    });

    it("strips only the first 'al-' prefix", () => {
      expect(CONSTANTS.agentNameFromFamily("al-al-nested")).toBe("al-nested");
    });
  });

  describe("containerName", () => {
    it("builds a container name with 'al-' prefix, agent name, and run ID", () => {
      expect(CONSTANTS.containerName("my-agent", "abc123")).toBe("al-my-agent-abc123");
    });

    it("includes the runId in the output", () => {
      const name = CONSTANTS.containerName("worker", "run-42");
      expect(name).toBe("al-worker-run-42");
    });
  });

  describe("agentImage", () => {
    it("returns agent-specific image tag with GIT_SHA", () => {
      expect(CONSTANTS.agentImage("my-agent")).toBe(`al-my-agent:${GIT_SHA}`);
    });
  });

  describe("CREDS_DIR_MODE", () => {
    it("is a number", () => {
      expect(typeof CONSTANTS.CREDS_DIR_MODE).toBe("number");
    });
  });

  describe("CREDS_FILE_MODE", () => {
    it("is a number", () => {
      expect(typeof CONSTANTS.CREDS_FILE_MODE).toBe("number");
    });
  });
});
