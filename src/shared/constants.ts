/**
 * Provider-agnostic constants shared across local and cloud runtimes.
 *
 * Provider-specific constants live in:
 *   - src/cloud/aws/constants.ts (AWS_CONSTANTS)
 *   - src/cloud/gcp/constants.ts (GCP_CONSTANTS)
 */

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

  /** Default base Docker image */
  DEFAULT_IMAGE: "al-agent:latest",

  /** Project-level base image (extends DEFAULT_IMAGE with user customizations) */
  PROJECT_BASE_IMAGE: "al-project-base:latest",

  /** Agent-specific Docker image tag */
  agentImage: (agentName: string) => `al-${agentName}:latest`,

  /** Temp directory prefix for credential staging */
  CREDS_TEMP_PREFIX: "al-creds-",

  /** Scheduler Docker image tag */
  SCHEDULER_IMAGE: "al-scheduler:latest",
} satisfies Record<string, string | ((...args: any[]) => string)>;
