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

  it("handles pagination: fetches all pages before filtering", async () => {
    const page1Images = [
      makeDockerImage("img1", "2026-01-05T00:00:00Z"),
      makeDockerImage("img2", "2026-01-04T00:00:00Z"),
    ];
    const page2Images = [
      makeDockerImage("img3", "2026-01-03T00:00:00Z"),
      makeDockerImage("img4", "2026-01-02T00:00:00Z"),
    ];

    // First page returns nextPageToken
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: page1Images, nextPageToken: "page2token" }));
    // Second page has no nextPageToken
    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: page2Images }));
    // Delete calls for images beyond keepCount (img3, img4 should be deleted when keepCount=2)
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });

    await cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 2);

    // 2 list calls + 2 delete calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Verify pageToken was passed in second list call
    const secondListUrl = mockFetch.mock.calls[1][0];
    expect(secondListUrl).toContain("pageToken=page2token");
  });

  it("matches images with colon-tagged URIs as well as digest URIs", async () => {
    // Images with tag-based URIs (e.g. ":latest") instead of digest "@sha256:"
    const taggedImage = {
      name: `projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages/${IMAGE_NAME}:latest`,
      uri: `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}:latest`,
      tags: ["latest"],
      uploadTime: "2026-01-05T00:00:00Z",
      updateTime: "2026-01-05T00:00:00Z",
    };
    const digestImage = makeDockerImage("abc123", "2026-01-04T00:00:00Z");

    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: [taggedImage, digestImage] }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });

    await cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 1);

    // Both images match; 1 delete (keepCount=1 means keep taggedImage, delete digestImage)
    const deleteCalls = mockFetch.mock.calls.slice(1);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1].method).toBe("DELETE");
  });

  it("sorts images without uploadTime using updateTime as fallback", async () => {
    const imageWithoutUploadTime = {
      name: `projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages/${IMAGE_NAME}@sha256:noupload`,
      uri: `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}@sha256:noupload`,
      tags: ["no-upload"],
      // No uploadTime — only updateTime
      updateTime: "2026-01-03T00:00:00Z",
    };
    const newerImage = makeDockerImage("newer", "2026-01-05T00:00:00Z");
    const olderImage = makeDockerImage("older", "2026-01-01T00:00:00Z");

    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: [imageWithoutUploadTime, newerImage, olderImage] }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });

    // keepCount=2: should keep newerImage and imageWithoutUploadTime, delete olderImage
    await cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 2);

    // 1 delete (olderImage, which has uploadTime "2026-01-01")
    const deleteCalls = mockFetch.mock.calls.slice(1);
    expect(deleteCalls).toHaveLength(1);
    const deletedUrl = deleteCalls[0][0] as string;
    expect(deletedUrl).toContain("older");
  });

  it("handles images with neither uploadTime nor updateTime in sort", async () => {
    // Both images lack uploadTime and updateTime — sort falls back to empty string comparison
    const img1 = {
      name: `projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages/${IMAGE_NAME}@sha256:aaa`,
      uri: `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}@sha256:aaa`,
      tags: ["v1"],
    } as any;
    const img2 = {
      name: `projects/${PROJECT}/locations/${REGION}/repositories/${REPO}/dockerImages/${IMAGE_NAME}@sha256:bbb`,
      uri: `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}@sha256:bbb`,
      tags: ["v2"],
    } as any;

    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: [img1, img2] }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });

    // keepCount=1: delete one of the two images (order is stable when times are equal)
    await expect(cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 1)).resolves.toBeUndefined();

    const deleteCalls = mockFetch.mock.calls.slice(1);
    expect(deleteCalls).toHaveLength(1);
  });

  it("uses image name directly when it does not start with 'projects/'", async () => {
    // Some registry responses may return a short name rather than the full resource path
    const shortNameImage = {
      name: `${IMAGE_NAME}@sha256:shortname`,
      uri: `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}@sha256:shortname`,
      tags: ["v1"],
      uploadTime: "2026-01-02T00:00:00Z",
    };
    const newerImage = makeDockerImage("newer", "2026-01-05T00:00:00Z");

    mockFetch.mockResolvedValueOnce(mockOkResponse({ dockerImages: [shortNameImage, newerImage] }));
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });

    // keepCount=1: keep newerImage, delete shortNameImage
    await cleanupOldImages(mockAuth, PROJECT, REGION, REPO, IMAGE_NAME, 1);

    const deleteCalls = mockFetch.mock.calls.slice(1);
    expect(deleteCalls).toHaveLength(1);
    // The DELETE URL should use the short name as-is
    const [deleteUrl] = deleteCalls[0];
    expect(deleteUrl).toContain("shortname");
  });
});
