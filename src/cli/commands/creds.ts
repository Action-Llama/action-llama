import { readdirSync, statSync } from "fs";
import { resolve } from "path";
import { CREDENTIALS_DIR } from "../../shared/paths.js";

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
      console.log(`  ${ref}  (${fieldList})`);
    }
  }
}
