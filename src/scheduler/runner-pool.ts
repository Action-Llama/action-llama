/**
 * RunnerPool manages multiple instances of the same agent for parallel execution.
 * It provides load balancing across available runners and handles queuing when all are busy.
 */

export interface PoolRunner {
  isRunning: boolean;
  run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<any>;
}

export class RunnerPool {
  private runners: PoolRunner[] = [];
  private roundRobinIndex = 0;

  constructor(runners: PoolRunner[]) {
    if (runners.length === 0) {
      throw new Error("RunnerPool requires at least one runner");
    }
    this.runners = runners;
  }

  /**
   * Get the next available runner, or null if all are busy
   */
  getAvailableRunner(): PoolRunner | null {
    // Look for any available runner
    const availableRunner = this.runners.find(r => !r.isRunning);
    if (availableRunner) {
      return availableRunner;
    }
    return null;
  }

  /**
   * Get the next runner using round-robin, regardless of availability
   * Used for scheduled runs where we want to distribute evenly
   */
  getNextRunner(): PoolRunner {
    const runner = this.runners[this.roundRobinIndex];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.runners.length;
    return runner;
  }

  /**
   * Check if any runner in the pool is currently running
   */
  get hasRunningJobs(): boolean {
    return this.runners.some(r => r.isRunning);
  }

  /**
   * Get the count of running jobs
   */
  get runningJobCount(): number {
    return this.runners.filter(r => r.isRunning).length;
  }

  /**
   * Get the total number of runners in the pool
   */
  get size(): number {
    return this.runners.length;
  }

  /**
   * Get all runners (for debugging/introspection)
   */
  get allRunners(): PoolRunner[] {
    return [...this.runners];
  }
}