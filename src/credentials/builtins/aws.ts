import type { CredentialDefinition } from "../schema.js";
import { validateAWSCredentials } from "../../setup/validators.js";

const aws: CredentialDefinition = {
  id: "aws",
  label: "AWS Credentials",
  description: "AWS Access Key ID and Secret Access Key for programmatic access",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { name: "access_key_id", label: "Access Key ID", description: "AWS Access Key ID (AKIA...)", secret: false },
    { name: "secret_access_key", label: "Secret Access Key", description: "AWS Secret Access Key", secret: true },
    { name: "session_token", label: "Session Token (optional)", description: "AWS Session Token for temporary credentials", secret: true },
  ],
  envVars: { 
    access_key_id: "AWS_ACCESS_KEY_ID",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    session_token: "AWS_SESSION_TOKEN"
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` — use AWS CLI and SDKs directly",

  async validate(values) {
    await validateAWSCredentials(values.access_key_id, values.secret_access_key, values.session_token);
    return true;
  },
};

export default aws;