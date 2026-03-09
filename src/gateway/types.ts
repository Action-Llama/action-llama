export interface ContainerRegistration {
  containerName: string;
  agentName: string;
  /** Unique identifier for this runner instance (e.g. "my-agent-1"). Used as the lock holder. */
  instanceId: string;
  credentials?: Record<string, Record<string, Record<string, string>>>;
  onLogLine?: (line: string) => void;
}
