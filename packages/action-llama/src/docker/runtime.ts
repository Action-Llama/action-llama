import type { TelemetryConfig } from "../shared/config.js";

export interface RuntimeLaunchOpts {
  image: string;
  agentName: string;
  env: Record<string, string>;
  credentials: RuntimeCredentials;
  memory?: string;
  cpus?: number;
  serviceAccount?: string;
  telemetry?: TelemetryConfig;
}

/** Opaque credential payload — each runtime produces and consumes its own variant. */
export type RuntimeCredentials =
  | { strategy: "volume"; stagingDir: string; bundle: CredentialBundle }
  | { strategy: "tmpfs"; stagingDir: string; bundle: CredentialBundle }
  | { strategy: "host-user"; stagingDir: string; bundle: CredentialBundle }
  | { strategy: "secret-manager"; secretRefs: Array<{ secretName: string; mountPath: string }>; bundle: CredentialBundle };

export type CredentialBundle = Record<string, Record<string, Record<string, string>>>;

export interface BuildImageOpts {
  /** Tag for the built image */
  tag: string;
  /** Dockerfile path relative to context */
  dockerfile: string;
  /** Build context directory */
  contextDir: string;
  /** Optional callback for progress updates during the build */
  onProgress?: (message: string) => void;
  /** Base image to use for FROM rewriting */
  baseImage?: string;
  /**
   * Extra files to bake into the image at /app/static/.
   * Keys are filenames (e.g. "agent-config.json"), values are file contents.
   * Used to embed agent config and prompt skeleton so they don't need to be
   * passed as env vars at runtime (avoids Lambda's 4KB env var limit).
   */
  extraFiles?: Record<string, string>;
  /**
   * Inline Dockerfile content. When set, this is used instead of reading from
   * opts.dockerfile. Useful for generating minimal layered Dockerfiles that
   * add static files on top of an existing base image.
   */
  dockerfileContent?: string;
  /**
   * Additional tags to apply after building (e.g. semver and latest aliases).
   * The primary tag is `tag`; these are extra aliases pointing to the same image.
   */
  additionalTags?: string[];
  /** When true, hash package-lock.json instead of traversing dist/ for cache key. */
  useLockfileHash?: boolean;
}

export interface RunningAgent {
  agentName: string;
  taskId: string;
  /** Full runtime-specific identifier needed by kill(). */
  runtimeId: string;
  status: string;
  startedAt?: Date;
  trigger?: string;
}

/**
 * Core runtime interface — the lifecycle contract all runtimes must satisfy.
 * Covers launching, killing, credential management, and log access.
 */
export interface Runtime {
  /** Whether agents launched by this runtime need a gateway URL */
  readonly needsGateway: boolean;

  /** Check if a specific agent is already running. */
  isAgentRunning(agentName: string): Promise<boolean>;

  /** List all running agents managed by this runtime. */
  listRunningAgents(): Promise<RunningAgent[]>;

  /** Launch an agent and return its run ID */
  launch(opts: RuntimeLaunchOpts): Promise<string>;

  /** Stream agent stdout line-by-line. Returns a handle to stop streaming. */
  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void };

  /** Wait for an agent to exit. Returns the exit code. Throws on timeout. */
  waitForExit(runId: string, timeoutSeconds: number): Promise<number>;

  /** Kill a running agent */
  kill(runId: string): Promise<void>;

  /** Remove an agent run's resources */
  remove(runId: string): Promise<void>;

  /**
   * Resolve credential refs into runtime-native credential specs.
   * Stages files to a temp dir, returns credential payload.
   */
  prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials>;

  /**
   * Clean up credentials prepared by prepareCredentials().
   * Removes the staging directory.
   */
  cleanupCredentials(creds: RuntimeCredentials): void;

  /** Fetch recent log entries for an agent, optionally filtered to a specific task/instance. */
  fetchLogs(agentName: string, limit: number, taskId?: string): Promise<string[]>;

  /**
   * Follow logs for an agent by name, polling for new entries.
   * Unlike streamLogs (which follows a specific running task), this polls the
   * agent's log group directly — works even when no task is currently running.
   * Returns a handle to stop polling.
   */
  followLogs(
    agentName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
    taskId?: string,
  ): { stop: () => void };

  /** Return a URL for this task/execution, or null. */
  getTaskUrl(runId: string): string | null;

  /**
   * Inspect a running container and return its environment variables.
   * Returns null if the container is not found or inspection is not supported.
   * Optional — only implemented by runtimes that manage Docker containers directly.
   */
  inspectContainer?(containerName: string): Promise<{ env: Record<string, string> } | null>;
}

/**
 * Container-specific operations — separate from the core Runtime interface.
 * Runtimes that manage Docker images implement both Runtime and ContainerRuntime.
 */
export interface ContainerRuntime {
  /** Build a Docker image. Returns the image tag. */
  buildImage(opts: BuildImageOpts): Promise<string>;

  /** Push a local Docker image to a registry. Returns the remote image URI. */
  pushImage(localImage: string): Promise<string>;
}

/** Type guard to check if a runtime also supports container operations. */
export function isContainerRuntime(runtime: Runtime): runtime is Runtime & ContainerRuntime {
  return "buildImage" in runtime && "pushImage" in runtime;
}
