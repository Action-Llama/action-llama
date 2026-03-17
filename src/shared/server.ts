import { ConfigError } from "./errors.js";

export interface ServerConfig {
  host: string;
  user?: string;         // default: "root"
  port?: number;         // default: 22
  keyPath?: string;      // default: ssh-agent
  basePath?: string;     // default: "/opt/action-llama"
  gatewayPort?: number;  // default: 3000
  provider?: string;        // "vultr" when AL-provisioned
  vultrInstanceId?: string;
  vultrRegion?: string;
}

export function validateServerConfig(raw: unknown): ServerConfig {
  if (!raw || typeof raw !== "object") {
    throw new ConfigError("server config must be an object");
  }

  const config = raw as Record<string, unknown>;

  if (!config.host || typeof config.host !== "string") {
    throw new ConfigError("server.host is required and must be a string");
  }

  if (config.port !== undefined) {
    if (typeof config.port !== "number" || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new ConfigError("server.port must be an integer between 1 and 65535");
    }
  }

  if (config.basePath !== undefined) {
    if (typeof config.basePath !== "string" || !config.basePath.startsWith("/")) {
      throw new ConfigError("server.basePath must be an absolute path (starting with /)");
    }
  }

  if (config.user !== undefined && typeof config.user !== "string") {
    throw new ConfigError("server.user must be a string");
  }

  if (config.keyPath !== undefined && typeof config.keyPath !== "string") {
    throw new ConfigError("server.keyPath must be a string");
  }

  if (config.gatewayPort !== undefined) {
    if (typeof config.gatewayPort !== "number" || !Number.isInteger(config.gatewayPort) || config.gatewayPort < 1 || config.gatewayPort > 65535) {
      throw new ConfigError("server.gatewayPort must be an integer between 1 and 65535");
    }
  }

  return config as unknown as ServerConfig;
}
