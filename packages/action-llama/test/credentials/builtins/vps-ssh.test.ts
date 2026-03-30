import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdtempSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { confirm, input, password, select } from "@inquirer/prompts";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { execSync } from "child_process";
import vpsSsh from "../../../src/credentials/builtins/vps-ssh.js";

const mockedConfirm = vi.mocked(confirm);
const mockedInput = vi.mocked(input);
const mockedPassword = vi.mocked(password);
const mockedSelect = vi.mocked(select);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedMkdtempSync = vi.mocked(mkdtempSync);
const mockedRmSync = vi.mocked(rmSync);
const mockedExecSync = vi.mocked(execSync);

describe("vps_ssh credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(vpsSsh.id).toBe("vps_ssh");
    });

    it("has correct label", () => {
      expect(vpsSsh.label).toBe("VPS SSH Key");
    });

    it("has correct description mentioning VPS", () => {
      expect(vpsSsh.description).toContain("VPS");
    });

    it("has 2 fields", () => {
      expect(vpsSsh.fields).toHaveLength(2);
    });

    it("has private_key field that is secret", () => {
      const field = vpsSsh.fields.find((f) => f.name === "private_key");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(true);
    });

    it("has public_key field that is not secret", () => {
      const field = vpsSsh.fields.find((f) => f.name === "public_key");
      expect(field).toBeDefined();
      expect(field!.secret).toBe(false);
    });

    it("has no envVars", () => {
      expect(vpsSsh.envVars).toBeUndefined();
    });

    it("has a prompt function", () => {
      expect(typeof vpsSsh.prompt).toBe("function");
    });

    it("has no validate function", () => {
      expect(vpsSsh.validate).toBeUndefined();
    });
  });

  describe("prompt — reuse existing credentials", () => {
    it("returns existing values when user confirms reuse", async () => {
      const existing = { private_key: "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----", public_key: "ssh-rsa AAAA..." };
      mockedConfirm.mockResolvedValue(true as any);

      const result = await vpsSsh.prompt!(existing);

      expect(result).toEqual({ values: existing });
    });

    it("shows a preview of the public key when offering to reuse", async () => {
      const existing = { private_key: "-----BEGIN RSA PRIVATE KEY-----\n...", public_key: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB..." };
      mockedConfirm.mockResolvedValue(true as any);

      await vpsSsh.prompt!(existing);

      expect(mockedConfirm).toHaveBeenCalledOnce();
      const call = mockedConfirm.mock.calls[0][0] as any;
      expect(call.message).toContain(existing.public_key.slice(0, 40));
    });

    it("does not ask to reuse when private_key is missing", async () => {
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("  -----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----  " as any);
      mockedMkdtempSync.mockReturnValue("/tmp/fake-dir" as any);
      // execSync throws to trigger fallback to input
      mockedExecSync.mockImplementation(() => { throw new Error("ssh-keygen not available"); });
      mockedInput.mockResolvedValue("ssh-rsa AAAA pubkey" as any);

      await vpsSsh.prompt!({ public_key: "ssh-rsa AAAA..." });

      // Confirm should not have been called for reuse (no private_key)
      expect(mockedConfirm).not.toHaveBeenCalled();
    });

    it("does not ask to reuse when public_key is missing", async () => {
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("  -----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----  " as any);
      mockedMkdtempSync.mockReturnValue("/tmp/fake-dir" as any);
      mockedExecSync.mockImplementation(() => { throw new Error("ssh-keygen not available"); });
      mockedInput.mockResolvedValue("ssh-rsa AAAA pubkey" as any);

      await vpsSsh.prompt!({ private_key: "-----BEGIN RSA PRIVATE KEY-----\n..." });

      expect(mockedConfirm).not.toHaveBeenCalled();
    });
  });

  describe("prompt — generate new keypair", () => {
    it("generates a new ed25519 keypair and returns both keys", async () => {
      mockedSelect.mockResolvedValue("generate" as any);
      mockedMkdtempSync.mockReturnValue("/tmp/fake-keygen-dir" as any);
      mockedExecSync.mockReturnValue(Buffer.from("") as any);
      mockedReadFileSync
        .mockReturnValueOnce("-----BEGIN OPENSSH PRIVATE KEY-----\nGENERATED\n-----END OPENSSH PRIVATE KEY-----" as any)
        .mockReturnValueOnce("ssh-ed25519 AAAA generated-key action-llama" as any);

      const result = await vpsSsh.prompt!({});

      expect(result.values.private_key).toContain("GENERATED");
      expect(result.values.public_key).toBe("ssh-ed25519 AAAA generated-key action-llama");
    });

    it("calls ssh-keygen with ed25519 algorithm", async () => {
      mockedSelect.mockResolvedValue("generate" as any);
      mockedMkdtempSync.mockReturnValue("/tmp/fake-keygen-dir" as any);
      mockedExecSync.mockReturnValue(Buffer.from("") as any);
      mockedReadFileSync
        .mockReturnValueOnce("-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----" as any)
        .mockReturnValueOnce("ssh-ed25519 AAAA abc" as any);

      await vpsSsh.prompt!({});

      expect(mockedExecSync).toHaveBeenCalledOnce();
      const cmd = mockedExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain("ed25519");
      expect(cmd).toContain("action-llama");
    });

    it("cleans up temp directory after generating", async () => {
      mockedSelect.mockResolvedValue("generate" as any);
      mockedMkdtempSync.mockReturnValue("/tmp/fake-keygen-dir" as any);
      mockedExecSync.mockReturnValue(Buffer.from("") as any);
      mockedReadFileSync
        .mockReturnValueOnce("-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----" as any)
        .mockReturnValueOnce("ssh-ed25519 AAAA abc" as any);

      await vpsSsh.prompt!({});

      expect(mockedRmSync).toHaveBeenCalledWith("/tmp/fake-keygen-dir", { recursive: true, force: true });
    });
  });

  describe("prompt — import from file", () => {
    it("reads private key and derives public key from .pub file", async () => {
      mockedSelect.mockResolvedValue("file" as any);
      mockedInput.mockResolvedValue("/home/user/.ssh/id_rsa" as any);
      mockedExistsSync.mockImplementation((p: any) => {
        if (p === "/home/user/.ssh/id_rsa") return true;
        if (p === "/home/user/.ssh/id_rsa.pub") return true;
        return false;
      });
      mockedReadFileSync
        .mockReturnValueOnce("-----BEGIN RSA PRIVATE KEY-----\nFILE_KEY\n-----END RSA PRIVATE KEY-----" as any)
        .mockReturnValueOnce("ssh-rsa AAAA file-pub-key" as any);

      const result = await vpsSsh.prompt!({});

      expect(result.values.private_key).toContain("FILE_KEY");
      expect(result.values.public_key).toBe("ssh-rsa AAAA file-pub-key");
    });

    it("derives public key via ssh-keygen when .pub file is missing", async () => {
      mockedSelect.mockResolvedValue("file" as any);
      mockedInput.mockResolvedValue("/home/user/.ssh/id_ed25519" as any);
      mockedExistsSync.mockImplementation((p: any) => {
        if (p === "/home/user/.ssh/id_ed25519") return true;
        return false; // no .pub file
      });
      mockedReadFileSync.mockReturnValueOnce("-----BEGIN OPENSSH PRIVATE KEY-----\nED_KEY\n-----END OPENSSH PRIVATE KEY-----" as any);
      mockedExecSync.mockReturnValue(Buffer.from("ssh-ed25519 AAAA derived-key\n") as any);

      const result = await vpsSsh.prompt!({});

      expect(result.values.private_key).toContain("ED_KEY");
      expect(result.values.public_key).toBe("ssh-ed25519 AAAA derived-key");
    });

    it("throws when key file does not exist", async () => {
      mockedSelect.mockResolvedValue("file" as any);
      mockedInput.mockResolvedValue("/nonexistent/id_rsa" as any);
      mockedExistsSync.mockReturnValue(false as any);

      await expect(vpsSsh.prompt!({})).rejects.toThrow("SSH key not found at");
    });

    it("throws when public key cannot be derived and no .pub file exists", async () => {
      mockedSelect.mockResolvedValue("file" as any);
      mockedInput.mockResolvedValue("/home/user/.ssh/id_rsa" as any);
      mockedExistsSync.mockImplementation((p: any) => {
        if (p === "/home/user/.ssh/id_rsa") return true;
        return false;
      });
      mockedReadFileSync.mockReturnValueOnce("-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----" as any);
      mockedExecSync.mockImplementation(() => { throw new Error("ssh-keygen failed"); });

      await expect(vpsSsh.prompt!({})).rejects.toThrow("Could not read or derive public key");
    });
  });

  describe("prompt — paste key directly", () => {
    it("returns the pasted private key and derives public key", async () => {
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("  -----BEGIN RSA PRIVATE KEY-----\nPASTED\n-----END RSA PRIVATE KEY-----  " as any);
      mockedMkdtempSync.mockReturnValue("/tmp/al-keygen-xyz" as any);
      mockedExecSync.mockReturnValue(Buffer.from("ssh-rsa AAAA derived-from-paste\n") as any);

      const result = await vpsSsh.prompt!({});

      expect(result.values.private_key).toContain("PASTED");
      expect(result.values.public_key).toBe("ssh-rsa AAAA derived-from-paste");
    });

    it("falls back to input for public key when ssh-keygen fails", async () => {
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("-----BEGIN RSA PRIVATE KEY-----\nPASTED\n-----END RSA PRIVATE KEY-----" as any);
      mockedMkdtempSync.mockReturnValue("/tmp/al-keygen-xyz" as any);
      mockedExecSync.mockImplementation(() => { throw new Error("no ssh-keygen"); });
      mockedInput.mockResolvedValue("ssh-rsa AAAA manual-pubkey" as any);

      const result = await vpsSsh.prompt!({});

      expect(result.values.private_key).toContain("PASTED");
      expect(result.values.public_key).toBe("ssh-rsa AAAA manual-pubkey");
    });

    it("cleans up temp directory after paste derive", async () => {
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----" as any);
      mockedMkdtempSync.mockReturnValue("/tmp/al-keygen-cleanup" as any);
      mockedExecSync.mockReturnValue(Buffer.from("ssh-rsa AAAA pubkey\n") as any);

      await vpsSsh.prompt!({});

      expect(mockedRmSync).toHaveBeenCalledWith("/tmp/al-keygen-cleanup", { recursive: true, force: true });
    });

    it("also cleans up temp dir when ssh-keygen fails and falls back to input", async () => {
      mockedSelect.mockResolvedValue("paste" as any);
      mockedPassword.mockResolvedValue("-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----" as any);
      mockedMkdtempSync.mockReturnValue("/tmp/al-keygen-failclean" as any);
      mockedExecSync.mockImplementation(() => { throw new Error("no keygen"); });
      mockedInput.mockResolvedValue("ssh-rsa AAAA fallback-pubkey" as any);

      await vpsSsh.prompt!({});

      expect(mockedRmSync).toHaveBeenCalledWith("/tmp/al-keygen-failclean", { recursive: true, force: true });
    });

    describe("paste mode — password validate function", () => {
      async function capturePasswordValidate(): Promise<(v: string) => true | string> {
        let validateFn: ((v: string) => true | string) | undefined;
        mockedPassword.mockImplementationOnce((opts: any) => {
          validateFn = opts.validate;
          return Promise.resolve("-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----" as any);
        });
        mockedMkdtempSync.mockReturnValue("/tmp/al-keygen-val" as any);
        mockedExecSync.mockReturnValue(Buffer.from("ssh-rsa AAAA pubkey\n") as any);
        mockedSelect.mockResolvedValue("paste" as any);
        await vpsSsh.prompt!({});
        return validateFn!;
      }

      it("returns 'Key is required' for an empty string", async () => {
        const validate = await capturePasswordValidate();
        expect(validate("")).toBe("Key is required");
      });

      it("returns 'Key is required' for whitespace-only input", async () => {
        const validate = await capturePasswordValidate();
        expect(validate("   ")).toBe("Key is required");
      });

      it("returns error when input does not contain PRIVATE KEY header", async () => {
        const validate = await capturePasswordValidate();
        expect(validate("not a key at all")).toBe(
          "Does not look like a private key — expected a PEM-formatted key"
        );
      });

      it("returns true for a valid PEM private key string", async () => {
        const validate = await capturePasswordValidate();
        expect(validate("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toBe(true);
      });
    });

    describe("paste mode — fallback public key input validate function", () => {
      it("returns 'Public key is required' for empty input", async () => {
        mockedSelect.mockResolvedValue("paste" as any);
        mockedPassword.mockResolvedValue("-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----" as any);
        mockedMkdtempSync.mockReturnValue("/tmp/al-keygen-pubval" as any);
        mockedExecSync.mockImplementation(() => { throw new Error("no keygen"); });

        let pubValidateFn: ((v: string) => true | string) | undefined;
        mockedInput.mockImplementationOnce((opts: any) => {
          pubValidateFn = opts.validate;
          return Promise.resolve("ssh-rsa AAAA pubkey" as any);
        });

        await vpsSsh.prompt!({});

        expect(pubValidateFn).toBeDefined();
        expect(pubValidateFn!("")).toBe("Public key is required");
        expect(pubValidateFn!("  ")).toBe("Public key is required");
        expect(pubValidateFn!("ssh-rsa AAAA validkey")).toBe(true);
      });
    });
  });

  describe("prompt — file mode validate function", () => {
    it("validates that the file path is not empty", async () => {
      mockedSelect.mockResolvedValue("file" as any);

      let filePathValidateFn: ((v: string) => true | string) | undefined;
      mockedInput.mockImplementationOnce((opts: any) => {
        filePathValidateFn = opts.validate;
        return Promise.resolve("/home/user/.ssh/id_ed25519" as any);
      });

      mockedExistsSync.mockImplementation((p: any) => {
        if (p === "/home/user/.ssh/id_ed25519") return true;
        if (String(p).endsWith(".pub")) return false;
        return false;
      });
      mockedReadFileSync.mockReturnValueOnce("-----BEGIN OPENSSH PRIVATE KEY-----\nED_KEY\n-----END OPENSSH PRIVATE KEY-----" as any);
      mockedExecSync.mockReturnValue(Buffer.from("ssh-ed25519 AAAA derived\n") as any);

      await vpsSsh.prompt!({});

      expect(filePathValidateFn).toBeDefined();
      expect(filePathValidateFn!("")).toBe("Path is required");
      expect(filePathValidateFn!("  ")).toBe("Path is required");
      expect(filePathValidateFn!("/any/valid/path")).toBe(true);
    });
  });
});
