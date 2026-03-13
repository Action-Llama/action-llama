/**
 * Abstract credential backend interface.
 * Implementations provide read/write/list/exists for credential storage.
 * The filesystem backend wraps the ~/.action-llama/credentials/ layout.
 * Remote backends (e.g. Google Secret Manager) implement the same interface.
 */
export interface CredentialBackend {
  /** Read a single credential field. Returns undefined if not found. */
  read(type: string, instance: string, field: string): Promise<string | undefined>;

  /** Write a single credential field. */
  write(type: string, instance: string, field: string, value: string): Promise<void>;

  /** List all credential entries (type/instance/field triples). */
  list(): Promise<CredentialEntry[]>;

  /** Check if a credential instance exists (has at least one field). */
  exists(type: string, instance: string): Promise<boolean>;

  /** Read all fields for a credential instance. Returns undefined if instance doesn't exist. */
  readAll(type: string, instance: string): Promise<Record<string, string> | undefined>;

  /** Write all fields for a credential instance. */
  writeAll(type: string, instance: string, fields: Record<string, string>): Promise<void>;

  /** List all instances of a credential type. */
  listInstances(type: string): Promise<string[]>;
}

export interface CredentialEntry {
  type: string;
  instance: string;
  field: string;
}
