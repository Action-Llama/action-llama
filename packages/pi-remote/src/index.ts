/**
 * @action-llama/pi-remote — Pi extension for remote execution.
 *
 * Default export: Pi extension factory for interactive use (pi -e pi-remote).
 * Also exports programmatic factory and transport layer for headless use.
 */

// Re-export transport layer
export type { Transport, ExecResult, ExecOptions } from "./transport/index.js";
export {
  readFile,
  writeFile,
  DockerExecTransport,
  SshTransport,
  HostUserTransport,
  MemoryTransport,
  createTransportTools,
  createTransportBashOps,
  createTransportReadOps,
  createTransportWriteOps,
  createTransportEditOps,
  createTransportGrepOps,
  createTransportFindOps,
  createTransportLsOps,
} from "./transport/index.js";
export type { DockerExecTransportOpts } from "./transport/index.js";
export type { SshTransportOpts } from "./transport/index.js";
export type { HostUserTransportOpts } from "./transport/index.js";
export type { MemoryExecHandler } from "./transport/index.js";

// Config, binding, and extension exports (Phase 2+)
export { loadRemotesConfig, type RemotesConfig, type RemoteEntry } from "./config.js";
export { RemoteBinding } from "./binding.js";
export { createPiRemoteFactory } from "./factory.js";
export { handleRemoteCommand } from "./command.js";
export { formatStatusText } from "./status.js";

// Default export: Pi extension for interactive use
export { default } from "./extension.js";
