import type { CredentialDefinition } from "../schema.js";

const aws: CredentialDefinition = {
  id: "aws",
  label: "AWS Credentials",
  description: "AWS access key, secret key, and optional region for managing AWS resources",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { name: "access_key_id", label: "Access Key ID", description: "AWS access key ID (AKIA...)", secret: false },
    { name: "secret_access_key", label: "Secret Access Key", description: "AWS secret access key", secret: true },
    { name: "default_region", label: "Default Region", description: "AWS region (e.g., us-east-1, us-west-2)", secret: false },
  ],
  envVars: { 
    access_key_id: "AWS_ACCESS_KEY_ID",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    default_region: "AWS_DEFAULT_REGION"
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` — use AWS CLI and SDK directly",

  async validate(values) {
    // Basic validation - check that required fields are present
    if (!values.access_key_id) {
      throw new Error("Access Key ID is required");
    }
    if (!values.secret_access_key) {
      throw new Error("Secret Access Key is required");
    }
    if (values.access_key_id && !values.access_key_id.startsWith("AKIA")) {
      throw new Error("Access Key ID should start with AKIA");
    }
    return true;
  },
};

export default aws;