import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch for AWS API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set AWS credentials for tests
const origAccessKey = process.env.AWS_ACCESS_KEY_ID;
const origSecretKey = process.env.AWS_SECRET_ACCESS_KEY;

import { AwsSecretsManagerBackend } from "../../src/shared/asm-backend.js";

describe("AwsSecretsManagerBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  });

  afterEach(() => {
    if (origAccessKey) process.env.AWS_ACCESS_KEY_ID = origAccessKey;
    else delete process.env.AWS_ACCESS_KEY_ID;
    if (origSecretKey) process.env.AWS_SECRET_ACCESS_KEY = origSecretKey;
    else delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it("read returns secret value", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ SecretString: "ghp_abc123" }),
    });

    const value = await backend.read("github_token", "default", "token");
    expect(value).toBe("ghp_abc123");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://secretsmanager.us-east-1.amazonaws.com/");
    expect(opts.headers["X-Amz-Target"]).toBe("secretsmanager.GetSecretValue");
    expect(opts.body).toContain("action-llama/github_token/default/token");
  });

  it("read returns undefined for non-existent secret", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("ResourceNotFoundException"),
    });

    const value = await backend.read("github_token", "default", "token");
    expect(value).toBeUndefined();
  });

  it("write creates a new secret", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ Name: "action-llama/github_token/default/token" }),
    });

    await backend.write("github_token", "default", "token", "ghp_abc123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["X-Amz-Target"]).toBe("secretsmanager.CreateSecret");
    const body = JSON.parse(opts.body);
    expect(body.Name).toBe("action-llama/github_token/default/token");
    expect(body.SecretString).toBe("ghp_abc123");
  });

  it("write updates existing secret on ResourceExistsException", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    // CreateSecret fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("ResourceExistsException"),
    });
    // PutSecretValue succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await backend.write("github_token", "default", "token", "ghp_new");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].headers["X-Amz-Target"]).toBe("secretsmanager.PutSecretValue");
  });

  it("list returns credential entries matching prefix", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        SecretList: [
          { Name: "action-llama/github_token/default/token" },
          { Name: "action-llama/git_ssh/default/id_rsa" },
          { Name: "action-llama/git_ssh/default/username" },
          { Name: "other-prefix/something/else/field" },
        ],
      }),
    });

    const entries = await backend.list();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ type: "github_token", instance: "default", field: "token" });
    expect(entries[1]).toEqual({ type: "git_ssh", instance: "default", field: "id_rsa" });
  });

  it("uses custom secret prefix", async () => {
    const backend = new AwsSecretsManagerBackend("eu-west-1", "myapp");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ SecretString: "value" }),
    });

    await backend.read("github_token", "default", "token");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.SecretId).toBe("myapp/github_token/default/token");
  });

  it("listInstances returns unique instances for a type", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        SecretList: [
          { Name: "action-llama/git_ssh/default/id_rsa" },
          { Name: "action-llama/git_ssh/default/username" },
          { Name: "action-llama/git_ssh/botty/id_rsa" },
          { Name: "action-llama/github_token/default/token" },
        ],
      }),
    });

    const instances = await backend.listInstances("git_ssh");
    expect(instances).toEqual(expect.arrayContaining(["default", "botty"]));
    expect(instances).toHaveLength(2);
  });

  it("includes Authorization header with Sigv4 signature", async () => {
    const backend = new AwsSecretsManagerBackend("us-east-1");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ SecretString: "val" }),
    });

    await backend.read("github_token", "default", "token");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/);
    expect(headers["X-Amz-Date"]).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
