/**
 * Binding — mutable session state tracking the active remote.
 *
 * A binding holds a reference to the current remote name, its config entry,
 * and the connected Transport instance. It provides resolution logic to
 * determine which remote to use (flag > config default > env var > none).
 */

import type { Transport } from "./transport/index.js";
import type { RemoteEntry, RemotesConfig } from "./config.js";
import { UnknownRemoteError } from "./config.js";
import { DockerExecTransport } from "./transport/docker-exec.js";
import { SshTransport } from "./transport/ssh.js";
import { HostUserTransport } from "./transport/host-user.js";

/** Error thrown when a transport connection fails. */
export class TransportConnectionFailedError extends Error {
  constructor(name: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to connect to remote "${name}": ${msg}`);
    this.name = "TransportConnectionFailedError";
  }
}

export class RemoteBinding {
  /** Currently bound remote name, or null if unbound. */
  private _name: string | null = null;
  /** Currently bound remote config entry. */
  private _entry: RemoteEntry | null = null;
  /** Active Transport instance, or null if unbound. */
  private _transport: Transport | null = null;
  /** Remote working directory. */
  private _cwd: string | null = null;

  get name(): string | null { return this._name; }
  get entry(): RemoteEntry | null { return this._entry; }
  get transport(): Transport | null { return this._transport; }
  get cwd(): string | null { return this._cwd; }
  get isBound(): boolean { return this._transport !== null; }

  /**
   * Resolve which remote to bind to based on precedence:
   *  1. Explicit flag value
   *  2. Config defaultRemote
   *  3. PI_REMOTE env var
   *  4. null (no binding)
   */
  static resolveRemoteName(
    flagValue: string | undefined,
    config: RemotesConfig | null,
    envVar?: string,
  ): string | null {
    if (flagValue) return flagValue;
    if (config?.defaultRemote) return config.defaultRemote;
    if (envVar) return envVar;
    return null;
  }

  /**
   * Bind to a named remote. Creates and connects the Transport.
   * Closes any existing binding first.
   */
  async bind(name: string, config: RemotesConfig): Promise<void> {
    const entry = config.remotes[name];
    if (!entry) {
      throw new UnknownRemoteError(name, Object.keys(config.remotes));
    }

    // Close existing binding
    await this.unbind();

    const transport = createTransportFromEntry(entry);
    try {
      await transport.connect();
    } catch (err) {
      throw new TransportConnectionFailedError(name, err);
    }

    this._name = name;
    this._entry = entry;
    this._transport = transport;
    this._cwd = entry.cwd ?? (entry.type === "ssh" ? "~" : "/");
  }

  /** Unbind from the current remote, closing the Transport. */
  async unbind(): Promise<void> {
    if (this._transport) {
      try {
        await this._transport.close();
      } catch {
        // Best effort
      }
    }
    this._name = null;
    this._entry = null;
    this._transport = null;
    this._cwd = null;
  }
}

/** Create a Transport instance from a remote config entry. */
function createTransportFromEntry(entry: RemoteEntry): Transport {
  switch (entry.type) {
    case "container":
      if (!entry.container) throw new Error("Container remote requires 'container' field");
      return new DockerExecTransport({
        container: entry.container,
        user: entry.user,
        cwd: entry.cwd,
      });

    case "ssh":
      if (!entry.host) throw new Error("SSH remote requires 'host' field");
      return new SshTransport({
        host: entry.host,
        port: entry.port,
        user: entry.user,
        keyPath: entry.keyPath,
        cwd: entry.cwd,
        sshOptions: entry.sshOptions,
      });

    case "host-user":
      return new HostUserTransport({
        user: entry.user ?? "pi-agent",
        cwd: entry.cwd,
      });

    default:
      throw new Error(`Unknown remote type: ${(entry as any).type}`);
  }
}
