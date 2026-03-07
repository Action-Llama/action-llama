export interface RuntimeLaunchOpts {
  image: string;
  agentName: string;
  env: Record<string, string>;
  credentials: RuntimeCredentials;
  memory?: string;
  cpus?: number;
  serviceAccount?: string;
}

/** Opaque credential payload — each runtime produces and consumes its own variant. */
export type RuntimeCredentials =
  | { strategy: "volume"; stagingDir: string; bundle: CredentialBundle }
  | { strategy: "secrets-manager"; mounts: SecretMount[] };

export type CredentialBundle = Record<string, Record<string, Record<string, string>>>;

export interface SecretMount {
  /** Cloud-native secret identifier (e.g. GSM secret name, AWS ARN) */
  secretId: string;
  /** Path inside the container where the secret value will be mounted */
  mountPath: string;
}

export interface BuildImageOpts {
  /** Tag for the built image */
  tag: string;
  /** Dockerfile path relative to context */
  dockerfile: string;
  /** Build context directory */
  contextDir: string;
  /** Optional callback for progress updates during the build */
  onProgress?: (message: string) => void;
  /** Remote URI of the base image — used to rewrite FROM in cloud builds */
  baseImage?: string;
}

export interface RunningAgent {
  agentName: string;
  taskId: string;
  status: string;
  startedAt?: Date;
}

export interface ContainerRuntime {
  /** Whether containers launched by this runtime need a gateway URL */
  readonly needsGateway: boolean;

  /** Check if a specific agent is already running. */
  isAgentRunning(agentName: string): Promise<boolean>;

  /** List all running agent containers managed by this runtime. */
  listRunningAgents(): Promise<RunningAgent[]>;

  /** Launch a container and return its name/ID */
  launch(opts: RuntimeLaunchOpts): Promise<string>;

  /** Stream container stdout line-by-line. Returns a handle to stop streaming. */
  streamLogs(
    containerName: string,
    onLine: (line: string) => void,
    onStderr?: (text: string) => void
  ): { stop: () => void };

  /** Wait for a container to exit. Returns the exit code. Throws on timeout. */
  waitForExit(containerName: string, timeoutSeconds: number): Promise<number>;

  /** Kill a running container */
  kill(containerName: string): Promise<void>;

  /** Remove a container */
  remove(containerName: string): Promise<void>;

  /**
   * Resolve credential refs into runtime-native credential specs.
   * For local docker: stages files to a temp dir, returns volume mount path.
   * For cloud runtimes: maps refs to cloud secret manager names.
   */
  prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials>;

  /**
   * Build a Docker image.
   * For local docker: runs `docker build` locally.
   * For cloud runtimes: uses cloud build (e.g. Cloud Build).
   * Returns the image tag/URI.
   */
  buildImage(opts: BuildImageOpts): Promise<string>;

  /**
   * Push a local Docker image to the runtime's registry.
   * Returns the remote image URI. For local docker, returns the input unchanged.
   */
  pushImage(localImage: string): Promise<string>;

  /**
   * Clean up credentials prepared by prepareCredentials().
   * For local docker: removes the staging directory.
   * For cloud runtimes: no-op.
   */
  cleanupCredentials(creds: RuntimeCredentials): void;

  /** Fetch recent log entries for an agent. */
  fetchLogs(agentName: string, limit: number): Promise<string[]>;
}
