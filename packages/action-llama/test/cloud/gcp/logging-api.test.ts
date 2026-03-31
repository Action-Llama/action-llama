import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  listLogEntries,
  buildJobLogFilter,
  extractLogText,
} from "../../../src/cloud/gcp/logging-api.js";
import type { GcpAuth } from "../../../src/cloud/gcp/auth.js";

const mockAuth: GcpAuth = {
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
} as any;

const PROJECT = "my-project";
const REGION = "us-central1";
const JOB_ID = "al-myagent-abc123";

function mockOkResponse(data: any) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  };
}

describe("listLogEntries", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs to the entries:list endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ entries: [] }));
    await listLogEntries(mockAuth, PROJECT, `resource.type="cloud_run_job"`);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/entries:list");
    expect(opts.method).toBe("POST");
  });

  it("includes project in resourceNames", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ entries: [] }));
    await listLogEntries(mockAuth, PROJECT, "filter=test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.resourceNames).toContain(`projects/${PROJECT}`);
  });

  it("passes pageSize and orderBy when specified", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ entries: [] }));
    await listLogEntries(mockAuth, PROJECT, "filter", 50, "timestamp desc");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.pageSize).toBe(50);
    expect(body.orderBy).toBe("timestamp desc");
  });

  it("returns entries from response", async () => {
    const entries = [
      { textPayload: "Hello", timestamp: "2026-01-01T00:00:00Z" },
      { textPayload: "World", timestamp: "2026-01-01T00:00:01Z" },
    ];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ entries }));

    const resp = await listLogEntries(mockAuth, PROJECT, "filter");
    expect(resp.entries).toHaveLength(2);
    expect(resp.entries![0].textPayload).toBe("Hello");
  });

  it("returns empty entries when response has none", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({}));
    const resp = await listLogEntries(mockAuth, PROJECT, "filter");
    expect(resp.entries).toBeUndefined();
  });
});

describe("buildJobLogFilter", () => {
  it("builds filter with resource type, job name, and location", () => {
    const filter = buildJobLogFilter(REGION, JOB_ID);
    expect(filter).toContain(`resource.type="cloud_run_job"`);
    expect(filter).toContain(`resource.labels.job_name="${JOB_ID}"`);
    expect(filter).toContain(`resource.labels.location="${REGION}"`);
  });

  it("adds timestamp constraint when afterTimestamp is provided", () => {
    const filter = buildJobLogFilter(REGION, JOB_ID, "2026-01-01T00:00:00Z");
    expect(filter).toContain(`timestamp>"2026-01-01T00:00:00Z"`);
  });

  it("omits timestamp constraint when not provided", () => {
    const filter = buildJobLogFilter(REGION, JOB_ID);
    expect(filter).not.toContain("timestamp>");
  });
});

describe("extractLogText", () => {
  it("returns textPayload when present", () => {
    expect(extractLogText({ textPayload: "hello" })).toBe("hello");
  });

  it("returns JSON-stringified jsonPayload when present", () => {
    const entry = { jsonPayload: { message: "test", level: "INFO" } };
    const result = extractLogText(entry);
    expect(result).toContain("message");
    expect(result).toContain("test");
  });

  it("returns empty string when neither payload is present", () => {
    expect(extractLogText({})).toBe("");
  });

  it("prefers textPayload over jsonPayload", () => {
    const entry = { textPayload: "plain", jsonPayload: { message: "json" } };
    expect(extractLogText(entry)).toBe("plain");
  });
});
