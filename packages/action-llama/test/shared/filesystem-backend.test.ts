import { describe, it, expect, afterEach } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FilesystemBackend } from "../../src/shared/filesystem-backend.js";

describe("FilesystemBackend", () => {
  let tmpDir: string;
  let backend: FilesystemBackend;

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), "al-fs-backend-"));
    backend = new FilesystemBackend(tmpDir);
  }

  describe("write + read roundtrip", () => {
    it("writes and reads a single field", async () => {
      setup();
      await backend.write("github_token", "default", "token", "ghp_abc123");
      const value = await backend.read("github_token", "default", "token");
      expect(value).toBe("ghp_abc123");
    });

    it("returns undefined for non-existent field", async () => {
      setup();
      const value = await backend.read("nope", "nope", "nope");
      expect(value).toBeUndefined();
    });
  });

  describe("writeAll + readAll", () => {
    it("writes and reads multiple fields", async () => {
      setup();
      await backend.writeAll("git_ssh", "default", {
        id_rsa: "ssh-key-content",
        username: "Bot",
        email: "bot@example.com",
      });
      const fields = await backend.readAll("git_ssh", "default");
      expect(fields).toEqual({
        id_rsa: "ssh-key-content",
        username: "Bot",
        email: "bot@example.com",
      });
    });

    it("returns undefined for non-existent instance", async () => {
      setup();
      const fields = await backend.readAll("nope", "nope");
      expect(fields).toBeUndefined();
    });
  });

  describe("exists", () => {
    it("returns false for non-existent credential", async () => {
      setup();
      expect(await backend.exists("nope", "nope")).toBe(false);
    });

    it("returns true after writing", async () => {
      setup();
      await backend.write("test", "inst", "field", "val");
      expect(await backend.exists("test", "inst")).toBe(true);
    });
  });

  describe("list", () => {
    it("returns empty for empty directory", async () => {
      setup();
      const entries = await backend.list();
      expect(entries).toEqual([]);
    });

    it("lists all entries", async () => {
      setup();
      await backend.write("github_token", "default", "token", "ghp_abc");
      await backend.write("git_ssh", "default", "id_rsa", "key");
      await backend.write("git_ssh", "default", "username", "Bot");

      const entries = await backend.list();
      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual({ type: "github_token", instance: "default", field: "token" });
      expect(entries).toContainEqual({ type: "git_ssh", instance: "default", field: "id_rsa" });
      expect(entries).toContainEqual({ type: "git_ssh", instance: "default", field: "username" });
    });
  });

  describe("listInstances", () => {
    it("returns empty for non-existent type", async () => {
      setup();
      const instances = await backend.listInstances("nope");
      expect(instances).toEqual([]);
    });

    it("lists instances after writing", async () => {
      setup();
      await backend.write("github_token", "default", "token", "t1");
      await backend.write("github_token", "work", "token", "t2");

      const instances = await backend.listInstances("github_token");
      expect(instances.sort()).toEqual(["default", "work"]);
    });
  });

  describe("static methods", () => {
    it("readSync returns undefined for non-existent field", () => {
      setup();
      const value = FilesystemBackend.readSync("nope", "nope", "nope", tmpDir);
      expect(value).toBeUndefined();
    });

    it("readSync writes and reads a single field", () => {
      setup();
      FilesystemBackend.writeSync("github_token", "default", "token", "ghp_static123", tmpDir);
      const value = FilesystemBackend.readSync("github_token", "default", "token", tmpDir);
      expect(value).toBe("ghp_static123");
    });

    it("writeSync trims trailing newline on read", () => {
      setup();
      FilesystemBackend.writeSync("test", "inst", "field", "my-value", tmpDir);
      const value = FilesystemBackend.readSync("test", "inst", "field", tmpDir);
      expect(value).toBe("my-value");
    });

    it("readAllSync returns undefined for non-existent instance", () => {
      setup();
      const result = FilesystemBackend.readAllSync("nope", "nope", tmpDir);
      expect(result).toBeUndefined();
    });

    it("readAllSync returns all fields for existing instance", () => {
      setup();
      FilesystemBackend.writeSync("git_ssh", "default", "id_rsa", "private-key", tmpDir);
      FilesystemBackend.writeSync("git_ssh", "default", "username", "Bot", tmpDir);

      const result = FilesystemBackend.readAllSync("git_ssh", "default", tmpDir);
      expect(result).toEqual({ id_rsa: "private-key", username: "Bot" });
    });

    it("existsSync returns false for non-existent credential", () => {
      setup();
      expect(FilesystemBackend.existsSync("nope", "nope", tmpDir)).toBe(false);
    });

    it("existsSync returns true after writing a field", () => {
      setup();
      FilesystemBackend.writeSync("github_token", "default", "token", "val", tmpDir);
      expect(FilesystemBackend.existsSync("github_token", "default", tmpDir)).toBe(true);
    });

    it("readAllSync skips subdirectories inside the instance directory", () => {
      setup();
      FilesystemBackend.writeSync("git_ssh", "default", "id_rsa", "private-key", tmpDir);
      // Create a subdirectory inside the instance dir — should be skipped
      mkdirSync(resolve(tmpDir, "git_ssh", "default", "subdir"), { recursive: true });
      const result = FilesystemBackend.readAllSync("git_ssh", "default", tmpDir);
      expect(result).toEqual({ id_rsa: "private-key" });
    });

    it("readAllSync returns undefined when instance dir has only subdirectories (no files)", () => {
      setup();
      // Create instance dir with only a subdirectory
      mkdirSync(resolve(tmpDir, "git_ssh", "default", "only-subdir"), { recursive: true });
      const result = FilesystemBackend.readAllSync("git_ssh", "default", tmpDir);
      expect(result).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("list() returns empty array when baseDir does not exist", async () => {
      // Use a non-existent directory as the base
      const nonExistentDir = join(tmpdir(), "al-nonexistent-" + Date.now());
      const backend2 = new FilesystemBackend(nonExistentDir);
      const entries = await backend2.list();
      expect(entries).toEqual([]);
    });

    it("list() skips non-directory entries at the type level", async () => {
      setup();
      // Create a regular file at the type level (not a directory)
      writeFileSync(resolve(tmpDir, "not-a-dir"), "some content");
      await backend.write("github_token", "default", "token", "t1");
      const entries = await backend.list();
      // Only github_token/default/token should appear; the file "not-a-dir" at type level should be skipped
      expect(entries).toEqual([{ type: "github_token", instance: "default", field: "token" }]);
    });

    it("list() skips non-directory entries at the instance level", async () => {
      setup();
      // Create type dir, then put a regular file where an instance dir would be
      mkdirSync(resolve(tmpDir, "github_token"), { recursive: true });
      writeFileSync(resolve(tmpDir, "github_token", "not-an-instance-dir"), "content");
      await backend.write("github_token", "default", "token", "t1");
      const entries = await backend.list();
      // Only github_token/default/token; the file is skipped
      expect(entries).toEqual([{ type: "github_token", instance: "default", field: "token" }]);
    });

    it("list() skips subdirectories at the field level", async () => {
      setup();
      await backend.write("git_ssh", "default", "id_rsa", "key");
      // Create a subdirectory inside the instance dir — should be skipped during list()
      mkdirSync(resolve(tmpDir, "git_ssh", "default", "subdir"), { recursive: true });
      const entries = await backend.list();
      // Only id_rsa field, not the subdir
      expect(entries).toEqual([{ type: "git_ssh", instance: "default", field: "id_rsa" }]);
    });

    it("readAll() skips subdirectories inside instance directory", async () => {
      setup();
      await backend.write("git_ssh", "default", "id_rsa", "private-key");
      // Add a subdirectory inside the instance dir
      mkdirSync(resolve(tmpDir, "git_ssh", "default", "subdir"), { recursive: true });
      const result = await backend.readAll("git_ssh", "default");
      expect(result).toEqual({ id_rsa: "private-key" });
    });

    it("readAll() returns undefined when instance dir has only subdirectories", async () => {
      setup();
      // Create instance dir with only a subdirectory, no field files
      mkdirSync(resolve(tmpDir, "git_ssh", "default", "only-subdir"), { recursive: true });
      const result = await backend.readAll("git_ssh", "default");
      expect(result).toBeUndefined();
    });
  });
});
