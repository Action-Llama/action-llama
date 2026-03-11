/**
 * Performance optimization commands for Lambda deployments.
 */

import { promises as fs } from "fs";
import chalk from "chalk";
import { loadGlobalConfig } from "../../shared/config.js";
import { LambdaOptimizer } from "../../docker/lambda-optimization.js";

interface OptimizeOptions {
  project: string;
  prewarm?: boolean;
  provisionedConcurrency?: number;
  removeProvisioned?: boolean;
  status?: boolean;
}

export async function optimizeCommand(
  agentName: string | undefined,
  options: OptimizeOptions,
): Promise<void> {
  const projectDir = options.project;
  
  try {
    const config = loadGlobalConfig(projectDir);
    
    if (config.cloud?.provider !== "ecs") {
      console.log(chalk.red("Optimization is only available for AWS ECS deployments with Lambda runtime"));
      console.log("Configure AWS ECS provider with 'al cloud setup' to use Lambda runtime for agents with timeout <= 900s");
      return;
    }

    if (!config.cloud.awsRegion) {
      console.log(chalk.red("AWS region not configured"));
      console.log("Run 'al cloud setup' to configure AWS settings");
      return;
    }

    const optimizer = new LambdaOptimizer({
      awsRegion: config.cloud.awsRegion,
    });

    if (!agentName) {
      // List all agents and their optimization status
      const agentDirs = await fs.readdir(projectDir, { withFileTypes: true });
      const agents = agentDirs
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name);

      if (agents.length === 0) {
        console.log("No agents found in project");
        return;
      }

      console.log(chalk.bold("Agent Lambda Optimization Status:"));
      console.log("");

      for (const agent of agents) {
        try {
          const provisioned = await optimizer.getProvisionedConcurrency(agent);
          const status = provisioned ? 
            chalk.green(`✓ Provisioned (${provisioned})`) : 
            chalk.yellow("○ On-demand");
          console.log(`${agent.padEnd(20)} ${status}`);
        } catch (err: any) {
          console.log(`${agent.padEnd(20)} ${chalk.red("✗ Error: " + err.message)}`);
        }
      }

      console.log("");
      console.log("Usage:");
      console.log(`  ${chalk.cyan("al optimize <agent> --prewarm")}              Pre-warm function`);
      console.log(`  ${chalk.cyan("al optimize <agent> --provisioned-concurrency 2")} Set provisioned concurrency`);
      console.log(`  ${chalk.cyan("al optimize <agent> --remove-provisioned")}      Remove provisioned concurrency`);
      return;
    }

    if (options.prewarm) {
      console.log(`Pre-warming Lambda function for ${agentName}...`);
      await optimizer.preWarmFunction(agentName);
      console.log(chalk.green("✓ Pre-warm invocation sent"));
      console.log("Function should start faster on next invocation");
    }

    if (options.provisionedConcurrency !== undefined) {
      const concurrency = options.provisionedConcurrency;
      if (concurrency < 0) {
        console.log(chalk.red("Provisioned concurrency must be >= 0"));
        return;
      }
      
      console.log(`Setting provisioned concurrency to ${concurrency} for ${agentName}...`);
      await optimizer.setProvisionedConcurrency(agentName, concurrency);
      console.log(chalk.green("✓ Provisioned concurrency configured"));
      console.log(`This will eliminate cold starts but may increase costs`);
    }

    if (options.removeProvisioned) {
      console.log(`Removing provisioned concurrency for ${agentName}...`);
      await optimizer.removeProvisionedConcurrency(agentName);
      console.log(chalk.green("✓ Provisioned concurrency removed"));
      console.log("Function will use on-demand scaling");
    }

    if (options.status) {
      const provisioned = await optimizer.getProvisionedConcurrency(agentName);
      console.log(`${agentName} optimization status:`);
      if (provisioned) {
        console.log(chalk.green(`✓ Provisioned concurrency: ${provisioned}`));
      } else {
        console.log(chalk.yellow("○ Using on-demand scaling"));
      }
    }

  } catch (err: any) {
    console.log(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}