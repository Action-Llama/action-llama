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
