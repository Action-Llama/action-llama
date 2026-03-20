import { readdirSync, statSync, rmSync } from "fs";
import { resolve } from "path";
import { search, confirm } from "@inquirer/prompts";
import { CREDENTIALS_DIR } from "../../shared/paths.js";
import { resolveCredential, getBuiltinCredential, listBuiltinCredentialIds } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields, credentialDir } from "../../shared/credentials.js";

export async function list(): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(CREDENTIALS_DIR).filter((e) => {
      try {
        return statSync(resolve(CREDENTIALS_DIR, e)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    console.log(`No credentials found at ${CREDENTIALS_DIR}`);
    return;
  }

  if (entries.length === 0) {
    console.log(`No credentials found at ${CREDENTIALS_DIR}`);
    return;
  }

  for (const type of entries.sort()) {
    const typeDir = resolve(CREDENTIALS_DIR, type);
    let instances: string[];
    try {
      instances = readdirSync(typeDir).filter((e) => {
        try {
          return statSync(resolve(typeDir, e)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      continue;
    }

    if (instances.length === 0) continue;

    const def = getBuiltinCredential(type);
    const label = def ? def.label : type;
    console.log(`\n  ${label} (${type})`);

    for (const instance of instances.sort()) {
      const instanceDir = resolve(typeDir, instance);
      let fields: string[];
      try {
        fields = readdirSync(instanceDir).filter((e) => {
          try {
            return statSync(resolve(instanceDir, e)).isFile();
          } catch {
            return false;
          }
        });
      } catch {
        fields = [];
      }

      const ref = instance === "default" ? type : `${type}:${instance}`;
      const fieldList = fields.sort().join(", ");
      console.log(`    ${ref}  (${fieldList})`);
    }
  }

  console.log();
}

export async function add(ref: string): Promise<void> {
  const { type, instance } = parseCredentialRef(ref);

  let def;
  try {
    def = resolveCredential(type);
  } catch {
    const known = listBuiltinCredentialIds().join(", ");
    throw new Error(`Unknown credential type "${type}". Known types:\n  ${known}`);
  }

  if (await credentialExists(type, instance)) {
    console.log(`Credential "${ref}" already exists. Re-running setup to update it.\n`);
  }

  const result = await promptCredential(def, instance);
  if (!result || Object.keys(result.values).length === 0) {
    console.log("Aborted.");
    return;
  }

  await writeCredentialFields(type, instance, result.values);
  console.log(`\nCredential "${ref}" saved.`);
}

export async function rm(ref: string): Promise<void> {
  const { type, instance } = parseCredentialRef(ref);

  if (!(await credentialExists(type, instance))) {
    throw new Error(`Credential "${ref}" not found.`);
  }

  const dir = credentialDir(type, instance);
  rmSync(dir, { recursive: true, force: true });

  // Clean up empty type directory
  const typeDir = resolve(CREDENTIALS_DIR, type);
  try {
    const remaining = readdirSync(typeDir);
    if (remaining.length === 0) {
      rmSync(typeDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore — type dir may already be gone
  }

  console.log(`Credential "${ref}" removed.`);
}

export async function types(): Promise<void> {
  const ids = listBuiltinCredentialIds();
  const choices = ids.map((id) => {
    const def = getBuiltinCredential(id)!;
    return {
      name: `${def.label} — ${def.description}`,
      value: id,
    };
  });

  const selected = await search({
    message: "Search credential types:",
    source: (input) => {
      if (!input) return choices;
      const lower = input.toLowerCase();
      return choices.filter((c) => c.name.toLowerCase().includes(lower));
    },
  });

  const def = getBuiltinCredential(selected)!;
  console.log(`\n  ${def.label} (${def.id})`);
  console.log(`  ${def.description}`);
  if (def.helpUrl) console.log(`  Help: ${def.helpUrl}`);
  console.log(`  Fields: ${def.fields.map((f) => f.name).join(", ")}`);
  if (def.envVars) {
    const vars = Object.entries(def.envVars).map(([field, env]) => `${field} → ${env}`).join(", ");
    console.log(`  Env vars: ${vars}`);
  }
  if (def.agentContext) console.log(`  Agent context: ${def.agentContext}`);
  console.log();

  const shouldAdd = await confirm({ message: "Add this credential now?", default: false });
  if (shouldAdd) {
    await add(selected);
  }
}
