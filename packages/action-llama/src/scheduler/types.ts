export interface PeriodicEvent {
  type: "periodic";
  agentType: string;
  text: string;
  schedule: string;
  timezone: string;
}

export interface WebhookEvent {
  type: "webhook";
  agentType: string;
  text: string;
  source: string;
}

import type { InstanceLifecycle } from "./lifecycle/instance-lifecycle.js";

export interface AgentInstance {
  id: string;
  agentName: string;
  status: 'running' | 'completed' | 'error' | 'killed';
  startedAt: Date;
  trigger: string;
  runner?: any; // Reference to the actual runner instance
  lifecycle?: InstanceLifecycle; // Lifecycle state machine for this instance
}
