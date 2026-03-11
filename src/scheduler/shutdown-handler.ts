import { Cron } from "croner";
import type { Logger } from "../shared/logger.js";
import type { GatewayServer } from "../gateway/index.js";
import type { WorkQueue } from "./event-queue.js";

export class ShutdownHandler {
  private cronJobs: Cron[] = [];
  private gateway?: GatewayServer;
  private webhookQueue?: WorkQueue<any>;
  private logger: Logger;
  private registered = false;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  register(
    cronJobs: Cron[], 
    gateway?: GatewayServer, 
    webhookQueue?: WorkQueue<any>
  ): void {
    this.cronJobs = cronJobs;
    this.gateway = gateway;
    this.webhookQueue = webhookQueue;

    if (!this.registered) {
      process.on("SIGINT", this.shutdown.bind(this));
      process.on("SIGTERM", this.shutdown.bind(this));
      this.registered = true;
    }
  }

  private async shutdown(): Promise<void> {
    this.logger.info("Shutting down scheduler...");
    
    // Mark as shutting down and clear webhook queue
    if (this.webhookQueue) {
      this.webhookQueue.clearAll();
    }

    // Stop all cron jobs
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.logger.info("All cron jobs stopped");

    // Close gateway server
    if (this.gateway) {
      await this.gateway.close();
      this.logger.info("Gateway server stopped");
    }

    this.logger.info("Shutdown complete");
    process.exit(0);
  }

  // Method to trigger shutdown programmatically (for testing or manual shutdown)
  async triggerShutdown(): Promise<void> {
    await this.shutdown();
  }
}