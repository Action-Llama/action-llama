import { input, confirm } from "@inquirer/prompts";
import type { CredentialDefinition, CredentialPromptResult } from "./schema.js";
import { loadCredential } from "../shared/credentials.js";
import { loadStructuredCredential } from "../shared/credentials.js";

/**
 * Load existing credential values from disk, respecting single vs structured storage.
 */
function loadExistingValues(def: CredentialDefinition): Record<string, string> | undefined {
  if (def.fields.length === 1) {
    const raw = loadCredential(def.filename);
    if (!raw) return undefined;
    return { [def.fields[0].name]: raw };
  }
  return loadStructuredCredential(def.filename);
}

/**
 * Generic credential prompting driven by a CredentialDefinition.
 *
 * Flow:
 * 1. If the definition has a custom `prompt()`, delegate to it entirely
 * 2. Otherwise, check if credential exists on disk
 * 3. If exists, ask to reuse
 * 4. If not, show label/description/helpUrl, prompt for each field
 * 5. Run validator if defined
 * 6. Return field values (or undefined if user declined)
 */
export async function promptCredential(
  def: CredentialDefinition
): Promise<CredentialPromptResult | undefined> {
  const existing = loadExistingValues(def);

  // Custom prompt handler — delegates entirely
  if (def.prompt) {
    return def.prompt(existing);
  }

  // Default field-by-field prompting
  if (existing) {
    const reuse = await confirm({
      message: `Found existing ${def.label}. Use it?`,
      default: true,
    });
    if (reuse) return { values: existing };
  }

  // Show context
  if (def.helpUrl) {
    console.log(`${def.label}: ${def.description}`);
    console.log(`  → ${def.helpUrl}\n`);
  }

  const values: Record<string, string> = {};

  for (const field of def.fields) {
    const value = await input({
      message: `${field.label}:`,
      // TODO: inquirer doesn't have a native "secret" mode in @inquirer/prompts input;
      // for now we rely on terminal not echoing for password-type prompts.
      // The `secret` field is available for future password-input support.
      validate: (v) => (v.trim().length > 0 ? true : `${field.label} is required`),
    });
    values[field.name] = value.trim();
  }

  // Validate if validator is defined
  if (def.validate) {
    console.log(`Validating ${def.label}...`);
    await def.validate(values);
  }

  return { values };
}
