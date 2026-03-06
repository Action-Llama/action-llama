import { resolve } from "path";
import { resolveRemote } from "../../shared/config.js";
import { createBackendForRemote, createLocalBackend } from "../../shared/remote.js";
import type { CredentialBackend, CredentialEntry } from "../../shared/credential-backend.js";

export async function executePush(remoteName: string, opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const remoteConfig = resolveRemote(projectPath, remoteName);

  const local = createLocalBackend();
  const remote = await createBackendForRemote(remoteConfig);

  console.log(`Scanning local credentials...`);
  const localEntries = await local.list();

  if (localEntries.length === 0) {
    console.log("No local credentials found. Run 'al setup' first.");
    return;
  }

  // Group by type/instance for display
  const groups = groupEntries(localEntries);

  console.log(`Found ${localEntries.length} credential field(s) across ${groups.length} credential(s).`);
  console.log(`Pushing to remote "${remoteName}" (${remoteConfig.provider})...\n`);

  let pushed = 0;
  let skipped = 0;

  for (const group of groups) {
    const label = `${group.type}:${group.instance}`;
    process.stdout.write(`  ${label} ...`);

    for (const field of group.fields) {
      const value = await local.read(group.type, group.instance, field);
      if (value === undefined) {
        skipped++;
        continue;
      }
      await remote.write(group.type, group.instance, field, value);
      pushed++;
    }

    console.log(` ${group.fields.length} field(s) pushed`);
  }

  console.log(`\nDone. ${pushed} field(s) pushed, ${skipped} skipped.`);
}

export async function executePull(remoteName: string, opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const remoteConfig = resolveRemote(projectPath, remoteName);

  const local = createLocalBackend();
  const remote = await createBackendForRemote(remoteConfig);

  console.log(`Scanning remote "${remoteName}" credentials...`);
  const remoteEntries = await remote.list();

  if (remoteEntries.length === 0) {
    console.log("No credentials found on remote. Push some first with 'al creds push'.");
    return;
  }

  const groups = groupEntries(remoteEntries);

  console.log(`Found ${remoteEntries.length} credential field(s) across ${groups.length} credential(s).`);
  console.log(`Pulling to local...\n`);

  let pulled = 0;
  let skipped = 0;

  for (const group of groups) {
    const label = `${group.type}:${group.instance}`;
    process.stdout.write(`  ${label} ...`);

    for (const field of group.fields) {
      const value = await remote.read(group.type, group.instance, field);
      if (value === undefined) {
        skipped++;
        continue;
      }
      await local.write(group.type, group.instance, field, value);
      pulled++;
    }

    console.log(` ${group.fields.length} field(s) pulled`);
  }

  console.log(`\nDone. ${pulled} field(s) pulled, ${skipped} skipped.`);
}

interface CredentialGroup {
  type: string;
  instance: string;
  fields: string[];
}

function groupEntries(entries: CredentialEntry[]): CredentialGroup[] {
  const map = new Map<string, CredentialGroup>();
  for (const entry of entries) {
    const key = `${entry.type}:${entry.instance}`;
    if (!map.has(key)) {
      map.set(key, { type: entry.type, instance: entry.instance, fields: [] });
    }
    map.get(key)!.fields.push(entry.field);
  }
  return [...map.values()];
}
