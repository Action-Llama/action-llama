import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { ModelConfig } from "../shared/config.js";
import { BASH_COMMAND_PREFIX } from "./bash-prefix.js";

export interface SessionFactoryOpts {
  cwd: string;
  resourceLoader: any;
  settingsManager: any;
  loadCredential: (type: string, instance: string, field: string) => Promise<string | undefined>;
}

export async function createSessionForModel(
  modelConfig: ModelConfig,
  opts: SessionFactoryOpts,
) {
  const llmModel = getModel(modelConfig.provider as any, modelConfig.model as any);

  const authStorage = AuthStorage.create();
  if (modelConfig.authType !== "pi_auth") {
    const credentialType = `${modelConfig.provider}_key`;
    const credential = await opts.loadCredential(credentialType, "default", "token");
    if (credential) {
      authStorage.setRuntimeApiKey(modelConfig.provider, credential);
    }
  }

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model: llmModel,
    thinkingLevel: modelConfig.thinkingLevel,
    authStorage,
    resourceLoader: opts.resourceLoader,
    tools: createCodingTools(opts.cwd, {
      bash: { commandPrefix: BASH_COMMAND_PREFIX },
    }),
    sessionManager: SessionManager.inMemory(),
    settingsManager: opts.settingsManager,
  });

  return { session, authStorage };
}
