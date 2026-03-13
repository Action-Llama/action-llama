/**
 * GCP-specific resource naming constants.
 *
 * For provider-agnostic constants, see src/shared/constants.ts.
 */

export const GCP_CONSTANTS = {
  /** Per-agent GCP service account name */
  serviceAccountName: (agentName: string) => `al-${agentName}`,

  /** Per-agent GCP service account email */
  serviceAccountEmail: (agentName: string, gcpProject: string) =>
    `al-${agentName}@${gcpProject}.iam.gserviceaccount.com`,

  /** Default GCP Cloud Run service account */
  defaultGcpRunner: (gcpProject: string) => `al-runner@${gcpProject}.iam.gserviceaccount.com`,

  /** GCP Cloud Run service name for the cloud scheduler */
  SCHEDULER_CLOUD_RUN_SERVICE: "al-scheduler",
} satisfies Record<string, string | ((...args: any[]) => string)>;
