import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  listDockerImages,
  deleteDockerImage,
  cleanupOldImages,
} from "../../../src/cloud/gcp/artifact-registry-api.js";
import type { GcpAuth } from "../../../src/cloud/gcp/auth.js";

const mockAuth: GcpAuth = {
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
} as any;

const PROJECT = "my-project";
const REGION = "us-central1";
const REPO = "my-repo";
const IMAGE_NAME = "my-agent";

function mockOkResponse(data: any) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  };
}

function makeDockerImage(tag: string, uploadTime: string) {
  return {
    name: `projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages/${IMAGE_NAME}@sha256:${tag}`,
    uri: `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}@sha256:${tag}`,
    tags: [tag],
    uploadTime,
    updateTime: uploadTime,
  };
}

describe("listDockerImages", () => {
  beforeEach(() => mockFetch.mockReset());

  it("GETs the dockerImages endpoint", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: [] }));
    await listDockerImages(mockAuth, PROJECT, REGION, REPO);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(`/projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages`);
  });

  it("returns dockerImages array", async () => {
    const images = [makeDockerImage("abc123", "2026-01-01T00:00:00Z")];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: images }));

    const result = await listDockerImages(mockAuth, PROJECT, REGION, REPO);
    expect(result.dockerImages).toHaveLength(1);
  });

  it("returns empty array when no images", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({}));
    const result = await listDockerImages(mockAuth, PROJECT, REGION, REPO);
    expect(result.dockerImages).toEqual([]);
  });

  it("passes pageToken when provided", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: [] }));
    await listDockerImages(mockAuth, PROJECT, REGION, REPO, "nextpage123");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("pageToken=nextpage123");
  });
});

describe("deleteDockerImage", () => {
  beforeEach(() => mockFetch.mockReset());

  it("DELETEs the image by resource path", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("") });
    const imageName = `projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages/img@sha256:abc`;
    await deleteDockerImage(mockAuth, imageName);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(imageName);
    expect(opts.method).toBe("DELETE");
  });
});

describe("cleanupOldImages", () => {
  beforeEach(() => mockFetch.mockReset());

  it("keeps only the 3 most recent images and deletes the rest", async () => {
    const images = [
      makeDockerImage("img1", "2026-01-05T00:00:00Z"),
      makeDockerImage("img2", "2026-01-04T00:00:00Z"),
      makeDockerImage("img3", "2026-01-03T00:00:00Z"),
      makeDockerImage("img4", "2026-01-02T00:00:00Z"),
      makeDockerImage("img5", "2026-01-01T00:00:00Z"),
    ];

    // listDockerImages call (first page, no more pages)
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: images }));
    // 2 delete calls (for img4 and img5)
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });

    await cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 3);

    // First call is list, then 2 deletes
    const deleteCalls = mockFetch.mock.calls.slice(1);
    expect(deleteCalls).toHaveLength(2);
    for (const [, opts] of deleteCalls) {
      expect(opts.method).toBe("DELETE");
    }
  });

  it("does nothing when image count is within keepCount", async () => {
    const images = [
      makeDockerImage("img1", "2026-01-03T00:00:00Z"),
      makeDockerImage("img2", "2026-01-02T00:00:00Z"),
    ];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: images }));

    await cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 3);

    // Only 1 call (the list call), no deletes
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not fail if delete throws", async () => {
    const images = [
      makeDockerImage("img1", "2026-01-02T00:00:00Z"),
      makeDockerImage("img2", "2026-01-01T00:00:00Z"),
    ];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: images }));
    // Delete fails
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    // Should not throw
    await expect(cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 1)).resolves.toBeUndefined();
  });
});
