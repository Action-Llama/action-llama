import { readFileSync } from "fs";
import { resolve } from "path";
import { WebhookRegistry } from "../../webhooks/registry.js";
import { loadGlobalConfig } from "../../shared/config.js";
import { createLogger } from "../../shared/logger.js";
import type { WebhookProvider, DryRunResult, DryRunBindingResult } from "../../webhooks/types.js";

// Import webhook providers
import { GitHubWebhookProvider } from "../../webhooks/providers/github.js";
import { SentryWebhookProvider } from "../../webhooks/providers/sentry.js";
import { LinearWebhookProvider } from "../../webhooks/providers/linear.js";
import { MintlifyWebhookProvider } from "../../webhooks/providers/mintlify.js";
import { TestWebhookProvider } from "../../webhooks/providers/test.js";

export interface WebhookFixture {
  headers: Record<string, string | undefined>;
  body: any;
}

export interface WebhookCommandOptions {
  project: string;
  run?: boolean;
  source?: string;
}

export async function execute(command: string, fixturePath: string, opts: WebhookCommandOptions): Promise<void> {
  if (command !== "replay" && command !== "simulate") {
    throw new Error(`Unknown webhook command: ${command}`);
  }

  try {
    // Load fixture file
    const fixture = loadFixture(fixturePath);
    
    // Load project config to get webhook settings
    const config = loadGlobalConfig(opts.project);
    
    // Create logger
    const logger = createLogger(opts.project, "webhook-simulator");
    
    // Create webhook registry and register providers
    const registry = new WebhookRegistry(logger);
    
    // Register all available providers
    const providers = createWebhookProviders(config);
    providers.forEach(provider => {
      registry.registerProvider(provider);
    });
    
    // Load agent configurations and create bindings
    await loadAgentBindings(registry, config, opts.project);
    
    // Determine source
    const source = opts.source || detectSourceFromHeaders(fixture.headers);
    if (!source) {
      console.error("❌ Could not determine webhook source. Use --source to specify.");
      if (process.env.NODE_ENV !== "test") {
        process.exit(1);
      } else {
        throw new Error("Could not determine webhook source. Use --source to specify.");
      }
    }
    
    // Prepare request data
    const headers = fixture.headers;
    const rawBody = JSON.stringify(fixture.body);
    const secrets = getWebhookSecrets(config, source);
    
    // Run dry run dispatch
    const result = registry.dryRunDispatch(source, headers, rawBody, secrets);
    
    // Display results
    displayResults(result, source, fixture);
    
    // Handle interactive run option
    if (opts.run && result.ok && result.bindings.some(b => b.matched)) {
      await handleInteractiveRun(result, opts.project);
    }
    
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    } else {
      throw error;
    }
  }
}

function loadFixture(fixturePath: string): WebhookFixture {
  try {
    const absolutePath = resolve(fixturePath);
    const content = readFileSync(absolutePath, "utf-8");
    const parsed = JSON.parse(content);
    
    if (!parsed.headers || !parsed.body) {
      throw new Error("Fixture must have 'headers' and 'body' properties");
    }
    
    return parsed;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Failed to load fixture: file not found at '${fixturePath}'`);
    }
    throw new Error(`Failed to load fixture from '${fixturePath}': ${error.message}`);
  }
}

function createWebhookProviders(config: any): WebhookProvider[] {
  const providers: WebhookProvider[] = [];
  
  // Create providers based on config
  if (config.webhooks) {
    for (const [name, webhookConfig] of Object.entries(config.webhooks as Record<string, any>)) {
      const { type } = webhookConfig;
      
      switch (type) {
        case "github":
          providers.push(new GitHubWebhookProvider());
          break;
        case "sentry":
          providers.push(new SentryWebhookProvider());
          break;
        case "linear":
          providers.push(new LinearWebhookProvider());
          break;
        case "mintlify":
          providers.push(new MintlifyWebhookProvider());
          break;
        case "test":
          providers.push(new TestWebhookProvider());
          break;
        default:
          console.warn(`⚠️ Unknown webhook type: ${type} for ${name}`);
      }
    }
  }
  
  // Add default providers if none configured
  if (providers.length === 0) {
    providers.push(
      new GitHubWebhookProvider(),
      new SentryWebhookProvider(),
      new LinearWebhookProvider(),
      new MintlifyWebhookProvider(),
      new TestWebhookProvider()
    );
  }
  
  return providers;
}

async function loadAgentBindings(registry: WebhookRegistry, config: any, projectPath: string): Promise<void> {
  // Load agents from config and create webhook bindings
  if (!config.agents) {
    console.warn("⚠️ No agents configured in project");
    return;
  }
  
  for (const [agentName, agentConfig] of Object.entries(config.agents as Record<string, any>)) {
    if (agentConfig.trigger?.webhook) {
      const trigger = agentConfig.trigger.webhook;
      
      // Create a mock trigger function for dry run
      const triggerFn = () => true;
      
      // Create binding
      const binding = {
        agentName,
        type: trigger.source || "github", // Default to github if not specified
        source: trigger.source,
        filter: createFilterFromTrigger(trigger),
        trigger: triggerFn
      };
      
      registry.addBinding(binding);
    }
  }
}

function createFilterFromTrigger(trigger: any): any {
  const filter: any = {};
  
  // Map trigger properties to filter properties
  if (trigger.events) filter.events = trigger.events;
  if (trigger.actions) filter.actions = trigger.actions;
  if (trigger.repos) filter.repos = trigger.repos;
  if (trigger.org) filter.org = trigger.org;
  if (trigger.orgs) filter.orgs = trigger.orgs;
  if (trigger.organizations) filter.organizations = trigger.organizations;
  if (trigger.labels) filter.labels = trigger.labels;
  if (trigger.assignee) filter.assignee = trigger.assignee;
  if (trigger.author) filter.author = trigger.author;
  if (trigger.branches) filter.branches = trigger.branches;
  if (trigger.resources) filter.resources = trigger.resources;
  
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function detectSourceFromHeaders(headers: Record<string, string | undefined>): string | null {
  // Try to detect source from common webhook headers
  if (headers["x-github-event"]) return "github";
  if (headers["x-sentry-auth"] || headers["sentry-hook-resource"]) return "sentry";
  if (headers["x-linear-signature"]) return "linear";
  if (headers["x-mintlify-signature"]) return "mintlify";
  if (headers["x-test-event"]) return "test";
  
  return null;
}

function getWebhookSecrets(config: any, source: string): Record<string, string> | undefined {
  // In dry run mode, we might not have real secrets
  // Return empty object to skip signature validation
  return {};
}

function displayResults(result: DryRunResult, source: string, fixture: WebhookFixture): void {
  console.log(`🔍 Webhook Simulation Results`);
  console.log(`📡 Source: ${source}`);
  console.log(`✅ Validation: ${result.validationResult || 'N/A'}`);
  
  if (!result.ok) {
    console.log(`❌ Error: ${result.parseError}`);
    return;
  }
  
  if (result.context) {
    console.log(`\n📋 Webhook Context:`);
    console.log(`   Event: ${result.context.event}`);
    if (result.context.action) console.log(`   Action: ${result.context.action}`);
    console.log(`   Repo: ${result.context.repo}`);
    if (result.context.author) console.log(`   Author: ${result.context.author}`);
    if (result.context.number) console.log(`   Number: ${result.context.number}`);
    if (result.context.title) console.log(`   Title: ${result.context.title}`);
    if (result.context.labels?.length) console.log(`   Labels: ${result.context.labels.join(", ")}`);
    console.log(`   Sender: ${result.context.sender}`);
  }
  
  console.log(`\n🤖 Agent Matching Results:`);
  const matchedAgents = result.bindings.filter(b => b.matched);
  const unmatchedAgents = result.bindings.filter(b => !b.matched);
  
  if (matchedAgents.length > 0) {
    console.log(`\n✅ Matched Agents (${matchedAgents.length}):`);
    matchedAgents.forEach(binding => {
      console.log(`   • ${binding.agentName}`);
      binding.reasons.forEach(reason => {
        console.log(`     ${reason}`);
      });
      if (binding.filterDetails) {
        displayFilterDetails(binding.filterDetails);
      }
    });
  }
  
  if (unmatchedAgents.length > 0) {
    console.log(`\n❌ Unmatched Agents (${unmatchedAgents.length}):`);
    unmatchedAgents.forEach(binding => {
      console.log(`   • ${binding.agentName}`);
      binding.reasons.forEach(reason => {
        console.log(`     ${reason}`);
      });
      if (binding.filterDetails) {
        displayFilterDetails(binding.filterDetails);
      }
    });
  }
  
  if (result.bindings.length === 0) {
    console.log(`   (No agents configured for webhook triggers)`);
  }
}

function displayFilterDetails(details: any): void {
  const entries = Object.entries(details);
  if (entries.length === 0) return;
  
  console.log(`     Filter details:`);
  entries.forEach(([key, value]) => {
    const status = value ? "✓" : "✗";
    console.log(`       ${status} ${key}: ${value}`);
  });
}

async function handleInteractiveRun(result: DryRunResult, projectPath: string): Promise<void> {
  const matchedAgents = result.bindings.filter(b => b.matched);
  
  if (matchedAgents.length === 0) {
    console.log("\n⚠️ No matched agents to run");
    return;
  }
  
  console.log(`\n🚀 Interactive Run Mode`);
  console.log(`Found ${matchedAgents.length} matched agent(s):`);
  
  matchedAgents.forEach((agent, index) => {
    console.log(`   ${index + 1}. ${agent.agentName}`);
  });
  
  // For now, just display the information
  // In a full implementation, you would prompt the user to select and run an agent
  console.log(`\n💡 To run an agent manually:`);
  matchedAgents.forEach(agent => {
    console.log(`   al run ${agent.agentName} --project ${projectPath}`);
  });
}