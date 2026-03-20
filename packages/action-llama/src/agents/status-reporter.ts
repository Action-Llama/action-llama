import type { StatusTracker } from "../tui/status-tracker.js";

export class AgentStatusReporter {
  private statusTracker?: StatusTracker;

  constructor(statusTracker?: StatusTracker) {
    this.statusTracker = statusTracker;
  }

  /**
   * Mark the start of an agent run
   */
  startRun(agentName: string, reason?: string): void {
    if (!this.statusTracker) return;
    this.statusTracker.startRun(agentName, reason);
  }

  /**
   * Report status text for an agent (from al-status command signals)
   */
  reportStatus(agentName: string, text: string): void {
    if (!this.statusTracker) return;
    this.statusTracker.setAgentStatusText(agentName, text);
  }

  /**
   * Report an error for an agent
   */
  reportError(agentName: string, error: string): void {
    if (!this.statusTracker) return;
    this.statusTracker.setAgentError(agentName, error);
    this.statusTracker.addLogLine(agentName, `ERROR: ${error}`);
  }

  /**
   * Add a log line for an agent
   */
  addLogLine(agentName: string, message: string): void {
    if (!this.statusTracker) return;
    this.statusTracker.addLogLine(agentName, message);
  }

  /**
   * Mark the end of an agent run
   */
  endRun(agentName: string, elapsed: number, error?: string): void {
    if (!this.statusTracker) return;
    this.statusTracker.endRun(agentName, elapsed, error);
  }

  /**
   * Check if an agent is enabled
   */
  isAgentEnabled(agentName: string): boolean {
    if (!this.statusTracker) return true;
    return this.statusTracker.isAgentEnabled(agentName);
  }

  /**
   * Set the next run time for an agent (for scheduled agents)
   */
  setNextRunAt(agentName: string, date: Date | null): void {
    if (!this.statusTracker) return;
    this.statusTracker.setNextRunAt(agentName, date);
  }
}