import { input, password, confirm } from "@inquirer/prompts";
import type { CredentialDefinition, CredentialPromptResult } from "./schema.js";
import { loadCredentialFields } from "../shared/credentials.js";

/**
 * Load existing credential values from disk.
 */
async function loadExistingValues(def: CredentialDefinition, instance: string): Promise<Record<string, string> | undefined> {
  return await loadCredentialFields(def.id, instance);
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
  def: CredentialDefinition,
  instance: string = "default"
): Promise<CredentialPromptResult | undefined> {
  const existing = await loadExistingValues(def, instance);

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
  console.log(`\n  ${def.label}: ${def.description}`);
  if (def.helpUrl) {
    console.log(`  → ${def.helpUrl}`);
  }
  console.log();

  const values: Record<string, string> = {};

  for (const field of def.fields) {
    const prompt = field.secret ? password : input;
    const value = await prompt({
      message: `${def.label} — ${field.label}:`,
      mask: field.secret ? "*" : undefined,
      validate: (v: string) => (v.trim().length > 0 ? true : `${field.label} is required`),
    } as any);
    values[field.name] = value.trim();
  }

  // Validate if validator is defined
  if (def.validate) {
    console.log(`Validating ${def.label}...`);
    await def.validate(values);
  }

  return { values };
}
