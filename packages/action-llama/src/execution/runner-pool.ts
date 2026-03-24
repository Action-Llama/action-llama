/**
 * RunnerPool manages multiple instances of the same agent for parallel execution.
 * It provides load balancing across available runners and handles queuing when all are busy.
 */

export interface PoolRunner {
  isRunning: boolean;
  instanceId: string;
  abort?(): void;
  run(prompt: string, triggerInfo?: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string }): Promise<any>;
}

export class RunnerPool {
  private runners: PoolRunner[] = [];
  private roundRobinIndex = 0;

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
   * Get all available runners at once for parallel processing
   */
  getAllAvailableRunners(): PoolRunner[] {
    return this.runners.filter(r => !r.isRunning);
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
   * Add a runner to the pool
   */
  addRunner(runner: PoolRunner): void {
    this.runners.push(runner);
  }

  /**
   * Shrink pool to target size by removing idle runners.
   * Returns the number of runners removed.
   */
  shrinkTo(targetSize: number): number {
    let removed = 0;
    while (this.runners.length > targetSize) {
      let idleIdx = -1;
      for (let i = this.runners.length - 1; i >= 0; i--) {
        if (!this.runners[i].isRunning) { idleIdx = i; break; }
      }
      if (idleIdx === -1) break;
      this.runners.splice(idleIdx, 1);
      removed++;
    }
    return removed;
  }

  /**
   * Kill a specific instance by its instanceId
   */
  killInstance(id: string): boolean {
    const runner = this.runners.find(r => r.instanceId === id && r.isRunning);
    if (!runner) return false;
    if (runner.abort) runner.abort();
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