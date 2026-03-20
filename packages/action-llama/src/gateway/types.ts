export interface ContainerRegistration {
  containerName: string;
  agentName: string;
  /** Unique identifier for this runner instance (e.g. "my-agent-1"). Used as the lock holder. */
  instanceId: string;
}

export interface RerunRequest {
  secret: string;
}

export interface StatusRequest {
  secret: string;
  text: string;
}

export interface TriggerRequest {
  secret: string;
  targetAgent: string;
  context: string;
}

export interface ReturnRequest {
  secret: string;
  value: string;
}

export interface Session {
  id: string;
  createdAt: number;
  lastAccessed: number;
}
