/**
 * Docker runtime provider extensions
 */

import type { RuntimeExtension } from "../../extensions/types.js";
import { LocalDockerRuntime } from "../local-runtime.js";
import { SshDockerRuntime } from "../ssh-docker-runtime.js";

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
  provider: new SshDockerRuntime(),
  async init() { 
    // SSH runtime configuration will be handled by the runtime itself
  },
  async shutdown() { 
    // SSH connections are managed per-operation, no persistent state to clean up
  }
};