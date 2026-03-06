import type { CredentialDefinition } from "../schema.js";

const aws: CredentialDefinition = {
  id: "aws",
  label: "AWS Credentials",
  description: "AWS Access Key for managing AWS resources",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { name: "access_key_id", label: "Access Key ID", description: "AWS Access Key ID", secret: false },
    { name: "secret_access_key", label: "Secret Access Key", description: "AWS Secret Access Key", secret: true },
    { name: "default_region", label: "Default Region", description: "AWS default region (optional)", secret: false },
  ],
  envVars: { 
    access_key_id: "AWS_ACCESS_KEY_ID",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    default_region: "AWS_DEFAULT_REGION"
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` — use `aws` CLI and AWS SDKs directly",

  async validate(values) {
    // Basic validation that required fields are present
    if (!values.access_key_id || !values.secret_access_key) {
      throw new Error("Access Key ID and Secret Access Key are required");
    }
    
    if (values.access_key_id.length < 16 || values.access_key_id.length > 128) {
      throw new Error("AWS Access Key ID should be between 16 and 128 characters");
    }
    
    if (values.secret_access_key.length < 40) {
      throw new Error("AWS Secret Access Key should be at least 40 characters");
    }
    
    // We could add a real AWS API validation here, but for now basic validation is sufficient
    return true;
  },
};

export default aws;