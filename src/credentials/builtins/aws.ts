import type { CredentialDefinition } from "../schema.js";

const aws: CredentialDefinition = {
  id: "aws",
  label: "AWS Credentials",
  description: "AWS access credentials for managing AWS resources",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { name: "access_key_id", label: "Access Key ID", description: "AWS access key ID (AKIA...)", secret: false },
    { name: "secret_access_key", label: "Secret Access Key", description: "AWS secret access key", secret: true },
    { name: "session_token", label: "Session Token", description: "AWS session token (optional, for temporary credentials)", secret: true },
    { name: "region", label: "Default Region", description: "AWS region (optional, e.g. us-east-1)", secret: false },
  ],
  envVars: { 
    access_key_id: "AWS_ACCESS_KEY_ID", 
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    session_token: "AWS_SESSION_TOKEN",
    region: "AWS_DEFAULT_REGION"
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION` — use `aws` CLI and AWS SDKs directly",

  async validate(values) {
    // Basic validation - ensure required fields are present
    if (!values.access_key_id || !values.secret_access_key) {
      throw new Error("Access Key ID and Secret Access Key are required");
    }
    
    // Basic format validation for access key ID
    if (!values.access_key_id.match(/^AKIA[0-9A-Z]{16}$/)) {
      throw new Error("Access Key ID should start with 'AKIA' followed by 16 alphanumeric characters");
    }

    return true;
  },
};

export default aws;