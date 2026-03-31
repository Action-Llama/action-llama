import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  GcpApiError,
  gcpFetch,
  createJob,
  getJob,
  deleteJob,
  runJob,
  getExecution,
  listExecutions,
  pollExecutionUntilDone,
} from "../../../src/cloud/gcp/cloud-run-api.js";
import type { GcpAuth } from "../../../src/cloud/gcp/auth.js";

const mockAuth: GcpAuth = {
  getAccessToken: vi.fn().mockResolvedValue("test-bearer-token"),
} as any;

function mockResponse(data: any, status = 200) {
  const body = data !== null ? JSON.stringify(data) : "";
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(data),
  };
}

const PROJECT = "my-project";
const REGION = "us-central1";
const JOB_ID = "al-myagent-abc123";

describe("gcpFetch", () => {
  beforeEach(() => mockFetch.mockReset());

  it("adds Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ done: true }));
    await gcpFetch(mockAuth, "https://example.com/test");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-bearer-token",
        }),
      }),
    );
  });

  it("throws GcpApiError on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve("Not found") });
    await expect(gcpFetch(mockAuth, "https://example.com/test")).rejects.toThrow(GcpApiError);
  });

  it("GcpApiError has correct statusCode", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: () => Promise.resolve("Forbidden") });
    try {
      await gcpFetch(mockAuth, "https://example.com/test");
    } catch (err: any) {
      expect(err).toBeInstanceOf(GcpApiError);
      expect(err.statusCode).toBe(403);
    }
  });

  it("returns null for empty response body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("") });
    const result = await gcpFetch(mockAuth, "https://example.com/test");
    expect(result).toBeNull();
  });
});

describe("createJob", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs to the correct URL with jobId query param", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ name: "operations/123" }));
    const template = { template: { containers: [{ image: "my-image" }] } };
    await createJob(mockAuth, PROJECT, REGION, JOB_ID, template);

    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain(`/projects/${PROJECT}/locations/${REGION}/jobs`);
    expect(callUrl).toContain(`jobId=${JOB_ID}`);

    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });
});

describe("getJob", () => {
  beforeEach(() => mockFetch.mockReset());

  it("GETs the correct URL", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ name: `projects/${PROJECT}/locations/${REGION}/jobs/${JOB_ID}` }));
    await getJob(mockAuth, PROJECT, REGION, JOB_ID);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain(`/jobs/${JOB_ID}`);
    expect(mockFetch.mock.calls[0][1]?.method).toBeUndefined(); // default GET
  });
});

describe("deleteJob", () => {
  beforeEach(() => mockFetch.mockReset());

  it("DELETEs the correct URL", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ name: "operations/del" }));
    await deleteJob(mockAuth, PROJECT, REGION, JOB_ID);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain(`/jobs/${JOB_ID}`);
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
  });
});

describe("runJob", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs to the :run URL", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ name: "operations/run" }));
    await runJob(mockAuth, PROJECT, REGION, JOB_ID);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain(`/jobs/${JOB_ID}:run`);
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
  });
});

describe("getExecution", () => {
  beforeEach(() => mockFetch.mockReset());

  it("GETs the execution by full name", async () => {
    const execName = `projects/${PROJECT}/locations/${REGION}/jobs/${JOB_ID}/executions/exec1`;
    mockFetch.mockResolvedValueOnce(mockResponse({ name: execName, uid: "uid1", createTime: "2026-01-01T00:00:00Z" }));
    const exec = await getExecution(mockAuth, PROJECT, REGION, execName);
    expect(exec.name).toBe(execName);
    expect(mockFetch.mock.calls[0][0]).toContain(execName);
  });
});

describe("listExecutions", () => {
  beforeEach(() => mockFetch.mockReset());

  it("GETs the executions list URL", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ executions: [] }));
    const result = await listExecutions(mockAuth, PROJECT, REGION, JOB_ID);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain(`/jobs/${JOB_ID}/executions`);
    expect(result).toEqual([]);
  });

  it("returns executions array from response", async () => {
    const execs = [
      { name: "exec1", uid: "uid1", createTime: "2026-01-01T00:00:00Z", completionTime: "2026-01-01T01:00:00Z" },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse({ executions: execs }));
    const result = await listExecutions(mockAuth, PROJECT, REGION, JOB_ID);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("exec1");
  });
});

describe("pollExecutionUntilDone", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns when execution has completionTime", async () => {
    const execName = "projects/p/locations/r/jobs/j/executions/e1";
    mockFetch.mockResolvedValue(mockResponse({
      name: execName,
      uid: "uid1",
      createTime: "2026-01-01T00:00:00Z",
      completionTime: "2026-01-01T01:00:00Z",
      conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
    }));

    const promise = pollExecutionUntilDone(mockAuth, PROJECT, REGION, execName, 60000, 100);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.completionTime).toBeDefined();
  });

  it("throws on timeout", async () => {
    const execName = "projects/p/locations/r/jobs/j/executions/e1";
    // Always return pending
    mockFetch.mockResolvedValue(mockResponse({
      name: execName,
      uid: "uid1",
      createTime: "2026-01-01T00:00:00Z",
      conditions: [{ type: "Completed", state: "CONDITION_PENDING" }],
    }));

    const promise = pollExecutionUntilDone(mockAuth, PROJECT, REGION, execName, 100, 50);
    // Set up rejection assertion BEFORE advancing timers to prevent unhandled rejection
    const assertion = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });
});
