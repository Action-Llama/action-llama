/**
 * Docker runtime provider extensions
 */

import type { RuntimeExtension, ExtensionConfig } from "../../extensions/types.js";
import { LocalDockerRuntime } from "../local-runtime.js";
import { SshDockerRuntime } from "../ssh-docker-runtime.js";
import { CloudRunRuntime } from "../cloud-run-runtime.js";

/**
 * Local Docker runtime extension
 */
export const localDockerExtension: RuntimeExtension = {
  metadata: {
    name: "local",
    version: "1.0.0",
    description: "Local Docker runtime",
    type: "runtime",
    requiredCredentials: [] // Local Docker doesn't need credentials
  },
  provider: new LocalDockerRuntime(),
  async init() { 
    // Local Docker runtime doesn't need special initialization
  },
  async shutdown() { 
    // Local Docker runtime doesn't need special cleanup
  }
};

/**
 * SSH Docker runtime extension
 */
export const sshDockerExtension: RuntimeExtension = {
  metadata: {
    name: "ssh",
    version: "1.0.0",
    description: "SSH Docker runtime",
    type: "runtime",
    requiredCredentials: [
      { type: "ssh_host", description: "SSH host configuration" },
      { type: "ssh_key", description: "SSH private key", optional: true }
    ],
    providesCredentialTypes: [
      {
        type: "ssh_host",
        fields: ["host", "port", "username"],
        description: "SSH host configuration for remote Docker",
        validation: async (values) => {
          // Basic validation for required fields
          if (!values.host || !values.username) {
            throw new Error("SSH host and username are required");
          }
          if (values.port && isNaN(Number(values.port))) {
            throw new Error("SSH port must be a number");
          }
        }
      },
      {
        type: "ssh_key",
        fields: ["private_key"],
        description: "SSH private key for authentication",
        envMapping: { private_key: "SSH_PRIVATE_KEY" }
      }
    ]
  },
  provider: new SshDockerRuntime({
    host: process.env.SSH_HOST || "localhost",
    user: process.env.SSH_USER || "root",
    port: parseInt(process.env.SSH_PORT || "22"),
    keyPath: process.env.SSH_KEY_PATH || "~/.ssh/id_rsa"
  }),
  async init() { 
    // SSH runtime configuration will be handled by the runtime itself
  },
  async shutdown() { 
    // SSH connections are managed per-operation, no persistent state to clean up
  }
};

/**
 * Google Cloud Run Jobs runtime extension
 */
export const cloudRunDockerExtension: RuntimeExtension = {
  metadata: {
    name: "cloud-run",
    version: "1.0.0",
    description: "Google Cloud Run Jobs runtime — runs agents as ephemeral Cloud Run Jobs with credentials via Secret Manager",
    type: "runtime",
    requiredCredentials: [
      {
        type: "gcp_service_account",
        description: "GCP service account key for Cloud Run and Secret Manager access",
      },
    ],
  },
  provider: null as any,
  async init(config?: ExtensionConfig) {
    if (
      config?.keyJson &&
      config?.project &&
      config?.region &&
      config?.artifactRegistry
    ) {
      const { GcpAuth, parseServiceAccountKey } = await import("../../cloud/gcp/auth.js");
      const auth = new GcpAuth(parseServiceAccountKey(config.keyJson as string));
      this.provider = new CloudRunRuntime({
        auth,
        project: config.project as string,
        region: config.region as string,
        artifactRegistry: config.artifactRegistry as string,
        serviceAccount: config.serviceAccount as string | undefined,
      });
    }
  },
  async shutdown() {
    // Cloud Run Jobs are stateless — no persistent connections to clean up
  },
};