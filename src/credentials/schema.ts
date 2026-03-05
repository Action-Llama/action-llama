// --- Credential definition schema ---
// Each credential is defined as a code object implementing this interface.
// Built-in credentials ship with action-llama; custom credentials can be
// defined inline in agent definitions or as standalone modules.

export interface CredentialField {
  name: string;           // field key, e.g. "token", "clientId"
  label: string;          // human-readable, e.g. "Client ID"
  description: string;    // help text shown during prompting
  secret: boolean;        // mask input during prompting
}

export interface CredentialPromptResult {
  values: Record<string, string>;
  params?: Record<string, unknown>;  // extra data for linked agent params (e.g. Sentry org/projects)
}

export interface CredentialDefinition {
  id: string;             // unique identifier, e.g. "github-token"
  label: string;          // "GitHub Personal Access Token"
  description: string;    // "Used for repo access and webhook management"
  helpUrl?: string;       // "https://github.com/settings/tokens"

  // Storage
  filename: string;       // file in ~/.action-llama-credentials/

  // Shape: single value or structured
  fields: CredentialField[];
  // single field → stored as plain text (backward compatible)
  // multiple fields → stored as JSON object

  // Runtime injection
  envVars?: Record<string, string>;
  // Maps field name → env var name
  // e.g. { "token": "GITHUB_TOKEN" }

  // Prompt context for the LLM
  agentContext?: string;
  // e.g. "`GITHUB_TOKEN` / `GH_TOKEN` — use `gh` CLI and `git` directly"

  // Optional: validate credential values after prompting.
  // Return true if valid, or throw with a descriptive error message.
  validate?: (values: Record<string, string>) => Promise<boolean>;

  // Optional: custom interactive prompt flow.
  // If defined, replaces the default field-by-field prompting.
  // Receives the existing values (if any) for reuse decisions.
  prompt?: (existing?: Record<string, string>) => Promise<CredentialPromptResult | undefined>;
}
