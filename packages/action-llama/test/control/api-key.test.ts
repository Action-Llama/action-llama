import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureGatewayApiKey, loadGatewayApiKey } from "../../src/control/api-key.js";
import * as credentials from "../../src/shared/credentials.js";

vi.mock("../../src/shared/credentials.js", () => ({
  loadCredentialField: vi.fn(),
  writeCredentialField: vi.fn(),
}));

describe("ensureGatewayApiKey", () => {
  const mockedLoad = vi.mocked(credentials.loadCredentialField);
  const mockedWrite = vi.mocked(credentials.writeCredentialField);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing key without writing when one exists", async () => {
    mockedLoad.mockResolvedValue("existing-key-abc123");
    mockedWrite.mockResolvedValue(undefined);

    const result = await ensureGatewayApiKey();

    expect(result.key).toBe("existing-key-abc123");
    expect(result.generated).toBe(false);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("generates and stores a new key when none exists", async () => {
    mockedLoad.mockResolvedValue(undefined);
    mockedWrite.mockResolvedValue(undefined);

    const result = await ensureGatewayApiKey();

    expect(result.generated).toBe(true);
    expect(typeof result.key).toBe("string");
    expect(result.key.length).toBeGreaterThan(0);
    expect(mockedWrite).toHaveBeenCalledOnce();
    expect(mockedWrite).toHaveBeenCalledWith("gateway_api_key", "default", "key", result.key);
  });

  it("generated key is a base64url string", async () => {
    mockedLoad.mockResolvedValue(undefined);
    mockedWrite.mockResolvedValue(undefined);

    const result = await ensureGatewayApiKey();

    // base64url uses A-Z, a-z, 0-9, -, _ (no +, /, or =)
    expect(result.key).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("generated keys are long enough to be secure (at least 32 chars)", async () => {
    mockedLoad.mockResolvedValue(undefined);
    mockedWrite.mockResolvedValue(undefined);

    const result = await ensureGatewayApiKey();

    // 32 random bytes base64url encoded → ~43 chars
    expect(result.key.length).toBeGreaterThanOrEqual(32);
  });

  it("generates different keys on successive calls when none stored", async () => {
    mockedLoad.mockResolvedValue(undefined);
    mockedWrite.mockResolvedValue(undefined);

    const result1 = await ensureGatewayApiKey();
    const result2 = await ensureGatewayApiKey();

    expect(result1.key).not.toBe(result2.key);
  });

  it("loads from the correct credential type and instance", async () => {
    mockedLoad.mockResolvedValue("some-key");

    await ensureGatewayApiKey();

    expect(mockedLoad).toHaveBeenCalledWith("gateway_api_key", "default", "key");
  });
});

describe("loadGatewayApiKey", () => {
  const mockedLoad = vi.mocked(credentials.loadCredentialField);
  const mockedWrite = vi.mocked(credentials.writeCredentialField);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the stored key when one exists", async () => {
    mockedLoad.mockResolvedValue("existing-key-xyz");

    const result = await loadGatewayApiKey();

    expect(result).toBe("existing-key-xyz");
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("returns undefined when no key is stored", async () => {
    mockedLoad.mockResolvedValue(undefined);

    const result = await loadGatewayApiKey();

    expect(result).toBeUndefined();
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("reads from the correct credential type and instance", async () => {
    mockedLoad.mockResolvedValue("some-key");

    await loadGatewayApiKey();

    expect(mockedLoad).toHaveBeenCalledWith("gateway_api_key", "default", "key");
  });

  it("reflects key changes between calls (hot-reload)", async () => {
    mockedLoad.mockResolvedValueOnce("first-key").mockResolvedValueOnce("rotated-key");

    const first = await loadGatewayApiKey();
    const second = await loadGatewayApiKey();

    expect(first).toBe("first-key");
    expect(second).toBe("rotated-key");
  });
});
