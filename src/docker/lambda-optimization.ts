/**
 * Lambda performance optimization utilities.
 * 
 * Provides pre-warming, performance monitoring, and cold start reduction
 * strategies for Action Llama Lambda functions.
 */

import {
  LambdaClient,
  InvokeCommand,
  PutProvisionedConcurrencyConfigCommand,
  GetProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
} from "@aws-sdk/client-lambda";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";

export interface LambdaOptimizationConfig {
  awsRegion: string;
}

export class LambdaOptimizer {
  private lambdaClient: LambdaClient;

  constructor(config: LambdaOptimizationConfig) {
    this.lambdaClient = new LambdaClient({ region: config.awsRegion });
  }

  /**
   * Pre-warm a Lambda function by invoking it with a warm-up payload.
   * This helps reduce cold start times for subsequent invocations.
   */
  async preWarmFunction(agentName: string): Promise<void> {
    const functionName = AWS_CONSTANTS.lambdaFunction(agentName);
    
    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event", // Async invocation
        Payload: Buffer.from(JSON.stringify({
          source: "action-llama-warmup",
          warmup: true,
        })),
      }));
    } catch (err: any) {
      // Pre-warming failures are not critical
      console.warn(`Failed to pre-warm function ${functionName}: ${err.message}`);
    }
  }

  /**
   * Configure provisioned concurrency for a Lambda function to eliminate cold starts.
   * Use this for frequently-used agents that need consistent performance.
   */
  async setProvisionedConcurrency(agentName: string, concurrency: number): Promise<void> {
    const functionName = AWS_CONSTANTS.lambdaFunction(agentName);
    
    await this.lambdaClient.send(new PutProvisionedConcurrencyConfigCommand({
      FunctionName: functionName,
      Qualifier: "$LATEST",
      ProvisionedConcurrentExecutions: concurrency,
    }));
  }

  /**
   * Remove provisioned concurrency to reduce costs when high performance
   * is not required.
   */
  async removeProvisionedConcurrency(agentName: string): Promise<void> {
    const functionName = AWS_CONSTANTS.lambdaFunction(agentName);
    
    try {
      await this.lambdaClient.send(new DeleteProvisionedConcurrencyConfigCommand({
        FunctionName: functionName,
        Qualifier: "$LATEST",
      }));
    } catch (err: any) {
      if (err.name !== "ResourceNotFoundException") {
        throw err;
      }
      // Already removed or never configured
    }
  }

  /**
   * Check current provisioned concurrency configuration.
   */
  async getProvisionedConcurrency(agentName: string): Promise<number | null> {
    const functionName = AWS_CONSTANTS.lambdaFunction(agentName);
    
    try {
      const result = await this.lambdaClient.send(new GetProvisionedConcurrencyConfigCommand({
        FunctionName: functionName,
        Qualifier: "$LATEST",
      }));
      return result.RequestedProvisionedConcurrentExecutions || null;
    } catch (err: any) {
      if (err.name === "ResourceNotFoundException") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Batch pre-warm multiple agent functions.
   */
  async preWarmAgents(agentNames: string[]): Promise<void> {
    const preWarmPromises = agentNames.map(agentName => 
      this.preWarmFunction(agentName).catch(err => 
        console.warn(`Pre-warm failed for ${agentName}: ${err.message}`)
      )
    );
    
    await Promise.all(preWarmPromises);
  }
}

/**
 * Performance monitoring utilities for Lambda containers.
 */
export class LambdaPerformanceMonitor {
  static logColdStart(isWarmup: boolean): void {
    const initType = process.env.AWS_LAMBDA_INITIALIZATION_TYPE;
    const requestId = process.env.AWS_LAMBDA_LOG_STREAM_NAME;
    
    if (initType === "on-demand") {
      console.log(JSON.stringify({
        _log: true,
        level: "info",
        msg: "cold start detected",
        isWarmup,
        requestId,
        ts: Date.now(),
      }));
    } else {
      console.log(JSON.stringify({
        _log: true,
        level: "info", 
        msg: "warm start",
        isWarmup,
        requestId,
        ts: Date.now(),
      }));
    }
  }

  static logPerformanceMetrics(metrics: {
    initTimeMs: number;
    credentialsTimeMs: number;
    sessionCreationTimeMs: number;
    totalStartupTimeMs: number;
  }): void {
    console.log(JSON.stringify({
      _log: true,
      level: "info",
      msg: "performance metrics",
      ...metrics,
      ts: Date.now(),
    }));
  }
}