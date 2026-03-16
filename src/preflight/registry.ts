import type { PreflightProvider } from "./schema.js";
import { shellProvider } from "./providers/shell.js";
import { httpProvider } from "./providers/http.js";
import { gitCloneProvider } from "./providers/git-clone.js";

const builtinProviders: Record<string, PreflightProvider> = {
  [shellProvider.id]: shellProvider,
  [httpProvider.id]: httpProvider,
  [gitCloneProvider.id]: gitCloneProvider,
};

export function resolvePreflightProvider(id: string): PreflightProvider {
  const provider = builtinProviders[id];
  if (!provider) {
    const available = Object.keys(builtinProviders).join(", ");
    throw new Error(`Unknown preflight provider "${id}". Available: ${available}`);
  }
  return provider;
}

export function listPreflightProviders(): string[] {
  return Object.keys(builtinProviders);
}
