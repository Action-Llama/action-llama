import { readdirSync, statSync, rmSync } from "fs";
import { resolve } from "path";
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
    console.error(`Unknown credential type "${type}". Known types:\n  ${known}`);
    process.exit(1);
  }

  if (credentialExists(type, instance)) {
    console.log(`Credential "${ref}" already exists. Re-running setup to update it.\n`);
  }

  const result = await promptCredential(def, instance);
  if (!result || Object.keys(result.values).length === 0) {
    console.log("Aborted.");
    return;
  }

  writeCredentialFields(type, instance, result.values);
  console.log(`\nCredential "${ref}" saved.`);
}

export async function rm(ref: string): Promise<void> {
  const { type, instance } = parseCredentialRef(ref);

  if (!credentialExists(type, instance)) {
    console.error(`Credential "${ref}" not found.`);
    process.exit(1);
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
