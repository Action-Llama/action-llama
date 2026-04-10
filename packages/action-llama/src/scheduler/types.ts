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

import type { SessionLifecycle } from "../execution/lifecycle/session-lifecycle.js";
import type { PoolRunner } from "../execution/runner-pool.js";

export interface AgentSession {
  id: string;
  agentName: string;
  status: 'running' | 'waiting' | 'completed' | 'error' | 'killed';
  startedAt: Date;
  trigger: string;
  runner?: PoolRunner;
  lifecycle?: SessionLifecycle;
}
