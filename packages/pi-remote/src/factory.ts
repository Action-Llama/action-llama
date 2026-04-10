/**
 * Programmatic factory — creates a Pi extension backed by a pre-existing Transport.
 *
 * Used by action-llama's TransportAgentRunner to register transport-backed tools
 * without going through config discovery or interactive /remote commands.
 *
 * Usage:
 *   const factory = createPiRemoteFactory(transport, "/workspace");
 *   const { session } = await createAgentSession({ extensionFactories: [factory] });
 */

import type { Transport } from "./transport/index.js";
import {
  createTransportBashOps,
  createTransportReadOps,
  createTransportWriteOps,
  createTransportEditOps,
  createTransportGrepOps,
  createTransportFindOps,
  createTransportLsOps,
  createTransportTools,
} from "./transport/operations.js";

export interface PiRemoteFactoryOpts {
  /** Transport to use for all tool operations. */
  transport: Transport;
  /** Working directory on the remote. */
  cwd: string;
}

/**
 * Create a Pi extension factory that registers transport-backed tools.
 *
 * This is the programmatic entry point for headless use (action-llama scheduler).
 * It skips config discovery, /remote command registration, and status bar updates.
 *
 * Returns the array of Pi tools backed by the transport, identical to
 * what createTransportTools() returns.
 */
export function createPiRemoteFactory(transport: Transport, cwd: string) {
  return createTransportTools(transport, cwd);
}

/**
 * Create individual transport operation sets for consumers that need
 * fine-grained control over which tools to override.
 */
export function createPiRemoteOps(transport: Transport) {
  return {
    bash: createTransportBashOps(transport),
    read: createTransportReadOps(transport),
    write: createTransportWriteOps(transport),
    edit: createTransportEditOps(transport),
    grep: createTransportGrepOps(transport),
    find: createTransportFindOps(transport),
    ls: createTransportLsOps(transport),
  };
}
