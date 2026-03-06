import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the entire SDK module
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: vi.fn().mockImplementation(function (this: any) { this.send = mockSend; }),
    GetSecretValueCommand: vi.fn().mockImplementation(function (this: any, input: any) { this._type = "GetSecretValue"; this.input = input; }),
    CreateSecretCommand: vi.fn().mockImplementation(function (this: any, input: any) { this._type = "CreateSecret"; this.input = input; }),
    PutSecretValueCommand: vi.fn().mockImplementation(function (this: any, input: any) { this._type = "PutSecretValue"; this.input = input; }),
    ListSecretsCommand: vi.fn().mockImplementation(function (this: any, input: any) { this._type = "ListSecrets"; this.input = input; }),
  };
});

import { AwsSecretsManagerBackend } from "../../src/shared/asm-backend.js";

describe("AwsSecretsManagerBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("read returns secret value", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockSend.mockResolvedValueOnce({ SecretString: "ghp_abc123" });

    const value = await backend.read("github_token", "default", "token");
    expect(value).toBe("ghp_abc123");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command._type).toBe("GetSecretValue");
    expect(command.input.SecretId).toBe("action-llama/github_token/default/token");
  });

  it("read returns undefined for non-existent secret", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    const err = new Error("not found");
    err.name = "ResourceNotFoundException";
    mockSend.mockRejectedValueOnce(err);

    const value = await backend.read("github_token", "default", "token");
    expect(value).toBeUndefined();
  });

  it("write creates a new secret", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockSend.mockResolvedValueOnce({ Name: "action-llama/github_token/default/token" });

    await backend.write("github_token", "default", "token", "ghp_abc123");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command._type).toBe("CreateSecret");
    expect(command.input.Name).toBe("action-llama/github_token/default/token");
    expect(command.input.SecretString).toBe("ghp_abc123");
  });

  it("write updates existing secret on ResourceExistsException", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    // CreateSecret fails with ResourceExistsException
    const err = new Error("already exists");
    err.name = "ResourceExistsException";
    mockSend.mockRejectedValueOnce(err);

    // PutSecretValue succeeds
    mockSend.mockResolvedValueOnce({});

    await backend.write("github_token", "default", "token", "ghp_new");

    expect(mockSend).toHaveBeenCalledTimes(2);

    const createCmd = mockSend.mock.calls[0][0];
    expect(createCmd._type).toBe("CreateSecret");

    const putCmd = mockSend.mock.calls[1][0];
    expect(putCmd._type).toBe("PutSecretValue");
    expect(putCmd.input.SecretId).toBe("action-llama/github_token/default/token");
    expect(putCmd.input.SecretString).toBe("ghp_new");
  });

  it("list returns credential entries matching prefix", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "action-llama/github_token/default/token" },
        { Name: "action-llama/git_ssh/default/id_rsa" },
        { Name: "action-llama/git_ssh/default/username" },
        { Name: "other-prefix/something/else/field" },
      ],
      NextToken: undefined,
    });

    const entries = await backend.list();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ type: "github_token", instance: "default", field: "token" });
    expect(entries[1]).toEqual({ type: "git_ssh", instance: "default", field: "id_rsa" });
  });

  it("uses custom secret prefix", async () => {
    const backend = new AwsSecretsManagerBackend("eu-west-1", "myapp");

    mockSend.mockResolvedValueOnce({ SecretString: "value" });

    await backend.read("github_token", "default", "token");

    const command = mockSend.mock.calls[0][0];
    expect(command._type).toBe("GetSecretValue");
    expect(command.input.SecretId).toBe("myapp/github_token/default/token");
  });

  it("listInstances returns unique instances for a type", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "action-llama/git_ssh/default/id_rsa" },
        { Name: "action-llama/git_ssh/default/username" },
        { Name: "action-llama/git_ssh/botty/id_rsa" },
        { Name: "action-llama/github_token/default/token" },
      ],
      NextToken: undefined,
    });

    const instances = await backend.listInstances("git_ssh");
    expect(instances).toEqual(expect.arrayContaining(["default", "botty"]));
    expect(instances).toHaveLength(2);
  });
});
