/**
 * Provider-agnostic constants shared across local and cloud runtimes.
 *
 * Provider-specific constants live in:
 *   - src/cloud/aws/constants.ts (AWS_CONSTANTS)
 *   - src/cloud/gcp/constants.ts (GCP_CONSTANTS)
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION: string = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")).version;

function getGitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "dev";
  }
}

const GIT_SHA = getGitSha();

export { VERSION, GIT_SHA };

/**
 * Return all tags for an image name: git-sha (primary), semver, and latest.
 * The first element is the primary tag used for builds and deployments.
 */
export function imageTags(name: string): [primary: string, ...aliases: string[]] {
  return [`${name}:${GIT_SHA}`, `${name}:${VERSION}`, `${name}:latest`];
}

export const CONSTANTS = {
  /** Default prefix for secret names across all providers */
  DEFAULT_SECRET_PREFIX: "action-llama",

  /** Marker tag for filtering our tasks/containers */
  STARTED_BY: "action-llama",

  /** ECS task family / Cloud Run job name / Lambda function name for an agent */
  agentFamily: (agentName: string) => `al-${agentName}`,

  /** Strip the `al-` prefix to recover the agent name */
  agentNameFromFamily: (family: string) => family.startsWith("al-") ? family.slice(3) : family,

  /** Docker container name for a local agent run */
  containerName: (agentName: string, runId: string) => `al-${agentName}-${runId}`,

  /** Docker container name filter prefix */
  CONTAINER_FILTER: "al-",

  /** Docker network name */
  NETWORK_NAME: "al-net",

  /** Default base Docker image (primary tag — git SHA for immutability) */
  DEFAULT_IMAGE: `al-agent:${GIT_SHA}`,

  /** Project-level base image (extends DEFAULT_IMAGE with user customizations) */
  PROJECT_BASE_IMAGE: `al-project-base:${GIT_SHA}`,

  /** Agent-specific Docker image tag (primary — git SHA) */
  agentImage: (agentName: string) => `al-${agentName}:${GIT_SHA}`,

  /** Temp directory prefix for credential staging */
  CREDS_TEMP_PREFIX: "al-creds-",

  /** Scheduler Docker image tag (primary — git SHA) */
  SCHEDULER_IMAGE: `al-scheduler:${GIT_SHA}`,
} satisfies Record<string, string | ((...args: any[]) => string)>;
