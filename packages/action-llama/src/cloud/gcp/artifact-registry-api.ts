/**
 * Artifact Registry API client (for image cleanup).
 * Plain fetch() wrapper — no SDK dependency.
 */

import { gcpFetch } from "./cloud-run-api.js";
import type { GcpAuth } from "./auth.js";

const BASE_URL = "https://artifactregistry.googleapis.com/v1";

export interface DockerImage {
  name: string;
  uri: string;
  tags: string[];
  imageSizeBytes?: string;
  uploadTime?: string;
  updateTime?: string;
  buildTime?: string;
  mediaType?: string;
}

export async function listDockerImages(
  auth: GcpAuth,
  project: string,
  region: string,
  repo: string,
  pageToken?: string,
): Promise<{ dockerImages: DockerImage[]; nextPageToken?: string }> {
  let url = `${BASE_URL}/projects/${project}/locations/${region}/repositories/${repo}/dockerImages`;
  if (pageToken) url += `?pageToken=${encodeURIComponent(pageToken)}`;
  const data = await gcpFetch(auth, url);
  return {
    dockerImages: data?.dockerImages ?? [],
    nextPageToken: data?.nextPageToken,
  };
}

export async function deleteDockerImage(
  auth: GcpAuth,
  imageName: string,
): Promise<void> {
  // imageName is the full resource path from the list response
  await gcpFetch(auth, `${BASE_URL}/${imageName}`, { method: "DELETE" });
}

/**
 * Fetch ALL docker images across pages.
 */
async function listAllDockerImages(
  auth: GcpAuth,
  project: string,
  region: string,
  repo: string,
): Promise<DockerImage[]> {
  const all: DockerImage[] = [];
  let pageToken: string | undefined;
  do {
    const resp = await listDockerImages(auth, project, region, repo, pageToken);
    all.push(...resp.dockerImages);
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return all;
}

/**
 * Keep only the most recent `keepCount` images for the given image name.
 * Deletes all older images.
 */
export async function cleanupOldImages(
  auth: GcpAuth,
  project: string,
  region: string,
  repo: string,
  imageName: string,
  keepCount = 3,
): Promise<void> {
  const all = await listAllDockerImages(auth, project, region, repo);

  // Filter to images matching the given name (base name without tag)
  const registryBase = `${region}-docker.pkg.dev/${project}/${repo}/${imageName}`;
  const matching = all.filter(
    (img) => img.uri.startsWith(registryBase + "@") || img.uri.startsWith(registryBase + ":"),
  );

  // Sort by upload time descending (newest first)
  matching.sort((a, b) => {
    const ta = a.uploadTime ?? a.updateTime ?? "";
    const tb = b.uploadTime ?? b.updateTime ?? "";
    return tb.localeCompare(ta);
  });

  // Delete all beyond keepCount
  const toDelete = matching.slice(keepCount);
  for (const img of toDelete) {
    // The name field is already the full resource path
    const resourcePath = img.name.startsWith("projects/")
      ? img.name
      : img.name;
    try {
      await deleteDockerImage(auth, resourcePath);
    } catch {
      // Best effort — don't fail the push if cleanup fails
    }
  }
}
