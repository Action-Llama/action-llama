import type { CredentialDefinition } from "../schema.js";

const gcpServiceAccount: CredentialDefinition = {
  id: "gcp_service_account",
  label: "GCP Service Account Key",
  description:
    "Service account JSON key for Google Cloud Platform (required for Cloud Run Jobs runtime). " +
    "The service account needs roles/run.admin, roles/secretmanager.admin, and roles/artifactregistry.admin.",
  helpUrl: "https://cloud.google.com/iam/docs/keys-create-delete",
  fields: [
    {
      name: "key_json",
      label: "Key JSON",
      description: "Full contents of the service account JSON key file",
      secret: true,
    },
  ],
  envVars: { key_json: "GOOGLE_APPLICATION_CREDENTIALS_JSON" },
  agentContext:
    "`GOOGLE_APPLICATION_CREDENTIALS_JSON` — GCP service account key (runtime management, not typically needed by agents)",

  async validate(values) {
    let key: any;
    try {
      key = JSON.parse(values.key_json);
    } catch {
      throw new Error("Invalid JSON — expected a service account key file");
    }
    if (key.type !== "service_account") {
      throw new Error('JSON key type must be "service_account"');
    }
    if (!key.private_key || !key.client_email || !key.project_id) {
      throw new Error(
        "JSON key missing required fields (private_key, client_email, project_id)",
      );
    }
    const { GcpAuth, parseServiceAccountKey } = await import("../../cloud/gcp/auth.js");
    const auth = new GcpAuth(parseServiceAccountKey(values.key_json));
    await auth.getAccessToken();
    return true;
  },
};

export default gcpServiceAccount;
