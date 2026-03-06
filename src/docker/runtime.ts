export interface RuntimeLaunchOpts {
  image: string;
  agentName: string;
  env: Record<string, string>;
  credentialsStagingDir?: string;
  memory?: string;
  cpus?: number;
}

export interface ContainerRuntime {
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
}
