import type { CredentialDefinition } from "../schema.js";

const aws: CredentialDefinition = {
  id: "aws",
  label: "AWS Credentials",
  description: "AWS access key, secret key, and optional region for managing AWS resources",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { name: "access_key_id", label: "Access Key ID", description: "AWS access key ID (AKIA...)", secret: false },
    { name: "secret_access_key", label: "Secret Access Key", description: "AWS secret access key", secret: true },
    { name: "session_token", label: "Session Token", description: "AWS session token (optional, for temporary credentials)", secret: true },
    { name: "default_region", label: "Default Region", description: "AWS default region (e.g., us-east-1)", secret: false },
  ],
  envVars: {
    access_key_id: "AWS_ACCESS_KEY_ID",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    session_token: "AWS_SESSION_TOKEN",
    default_region: "AWS_DEFAULT_REGION",
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION` — use AWS CLI and SDKs directly",
};

export default aws;