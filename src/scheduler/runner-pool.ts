import type { AgentInstance } from "./types.js";

/**
 * RunnerPool manages multiple instances of the same agent for parallel execution.
 * It provides load balancing across available runners and handles queuing when all are busy.
 */

export interface PoolRunner {
  isRunning: boolean;
  instanceId?: string;
  abort?(): void;
  run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<any>;
}

export class RunnerPool {
  private runners: PoolRunner[] = [];
  private roundRobinIndex = 0;
  private instances: Map<string, AgentInstance> = new Map();

  constructor(runners: PoolRunner[]) {
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
  getNextRunner(): PoolRunner | null {
    if (this.runners.length === 0) return null;
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

  /**
   * Register a running agent instance
   */
  registerInstance(instance: AgentInstance): void {
    this.instances.set(instance.id, instance);
  }

  /**
   * Unregister an agent instance
   */
  unregisterInstance(id: string): void {
    this.instances.delete(id);
  }

  /**
   * Get all running instances
   */
  getInstances(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Kill a specific instance by ID
   */
  killInstance(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    if (instance.runner && typeof instance.runner.abort === 'function') {
      instance.runner.abort();
    }

    instance.status = 'killed';
    return true;
  }

  /**
   * Kill all running instances in this pool.
   * Returns the number of runners that were aborted.
   */
  killAll(): number {
    let killed = 0;
    for (const runner of this.runners) {
      if (runner.isRunning && runner.abort) {
        runner.abort();
        killed++;
      }
    }
    return killed;
  }
}