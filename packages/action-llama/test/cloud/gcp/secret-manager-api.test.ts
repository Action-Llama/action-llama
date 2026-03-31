import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  createSecret,
  addSecretVersion,
  deleteSecret,
  accessSecretVersion,
} from "../../../src/cloud/gcp/secret-manager-api.js";
import type { GcpAuth } from "../../../src/cloud/gcp/auth.js";

const mockAuth: GcpAuth = {
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
} as any;

const PROJECT = "my-project";
const SECRET_ID = "al-cred-abc123-github-token-default-api-key";

function mockOkResponse(data: any = {}) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  };
}

function mockErrorResponse(status: number, body = "") {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  };
}

describe("createSecret", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs to the secrets endpoint with correct secretId", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ name: `projects/${PROJECT}/secrets/${SECRET_ID}` }));
    await createSecret(mockAuth, PROJECT, SECRET_ID);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`/projects/${PROJECT}/secrets`);
    expect(url).toContain(`secretId=${SECRET_ID}`);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.replication).toEqual({ automatic: {} });
  });

  it("throws on error response", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(409, "Already exists"));
    await expect(createSecret(mockAuth, PROJECT, SECRET_ID)).rejects.toThrow();
  });
});

describe("addSecretVersion", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs to :addVersion with base64-encoded payload", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ name: "version1" }));
    const payload = "my-secret-value";
    await addSecretVersion(mockAuth, PROJECT, SECRET_ID, payload);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`:addVersion`);
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    const decoded = Buffer.from(body.payload.data, "base64").toString("utf-8");
    expect(decoded).toBe(payload);
  });
});

describe("deleteSecret", () => {
  beforeEach(() => mockFetch.mockReset());

  it("DELETEs the secret resource", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("") });
    await deleteSecret(mockAuth, PROJECT, SECRET_ID);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`/secrets/${SECRET_ID}`);
    expect(opts.method).toBe("DELETE");
  });
});

describe("accessSecretVersion", () => {
  beforeEach(() => mockFetch.mockReset());

  it("GETs the latest version and decodes the payload", async () => {
    const value = "my-credential-value";
    const encoded = Buffer.from(value, "utf-8").toString("base64");
    mockFetch.mockResolvedValueOnce(mockOkResponse({ payload: { data: encoded } }));

    const result = await accessSecretVersion(mockAuth, PROJECT, SECRET_ID);
    expect(result).toBe(value);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(":access");
    expect(url).toContain("latest");
  });

  it("uses specified version when provided", async () => {
    const encoded = Buffer.from("value", "utf-8").toString("base64");
    mockFetch.mockResolvedValueOnce(mockOkResponse({ payload: { data: encoded } }));

    await accessSecretVersion(mockAuth, PROJECT, SECRET_ID, "3");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/versions/3:access");
  });
});
