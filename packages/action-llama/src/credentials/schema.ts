// --- Credential definition schema ---
// Each credential type is a directory under CREDENTIALS_DIR/<type>/<instance>/
// containing one file per field. Built-in credentials ship with action-llama.

export interface CredentialField {
  name: string;           // field key and filename on disk, e.g. "token", "id_rsa"
  label: string;          // human-readable, e.g. "Client ID"
  description: string;    // help text shown during prompting
  secret: boolean;        // mask input during prompting
}

export interface CredentialPromptResult {
  values: Record<string, string>;
  params?: Record<string, unknown>;  // extra data for linked agent params (e.g. Sentry org/projects)
}

export interface CredentialDefinition {
  id: string;             // credential type, e.g. "github_token" — also the directory name
  label: string;          // "GitHub Personal Access Token"
  description: string;    // "Used for repo access and webhook management"
  helpUrl?: string;       // "https://github.com/settings/tokens"

  // Shape: one file per field under <type>/<instance>/
  fields: CredentialField[];

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
