import type { AgentConfig, ModelConfig } from "../../shared/config.js";
import { ModelCircuitBreaker } from "../model-fallback.js";
import { ClaudeCliHarness } from "./claude-cli-harness.js";
import { PiHarness } from "./pi-harness.js";
import type { AgentHarness } from "./types.js";

export interface CreateHarnessOpts {
  resourceLoader: any;
  settingsManager: any;
  providerKeys?: Map<string, string>;
}

function getPrimaryModel(agentConfig: AgentConfig): ModelConfig {
  if (!agentConfig.models.length) {
    throw new Error(`Agent "${agentConfig.name}" has no models configured.`);
  }
  return agentConfig.models[0];
}

export function createHarness(agentConfig: AgentConfig, opts: CreateHarnessOpts): AgentHarness {
  const harnessType = agentConfig.harness?.type || "pi";

  if (harnessType === "claude") {
    return new ClaudeCliHarness({
      model: getPrimaryModel(agentConfig),
    });
  }

  return new PiHarness({
    models: agentConfig.models,
    circuitBreaker: new ModelCircuitBreaker(),
    resourceLoader: opts.resourceLoader,
    settingsManager: opts.settingsManager,
    providerKeys: opts.providerKeys,
  });
}
