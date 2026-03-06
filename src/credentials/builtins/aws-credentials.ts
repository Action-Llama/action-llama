import type { CredentialDefinition } from "../schema.js";

const awsCredentials: CredentialDefinition = {
  id: "aws_credentials",
  label: "AWS Credentials",
  description: "AWS access key and secret key for managing AWS resources",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { name: "access_key_id", label: "Access Key ID", description: "AWS Access Key ID (AKIA...)", secret: false },
    { name: "secret_access_key", label: "Secret Access Key", description: "AWS Secret Access Key", secret: true },
    { name: "region", label: "Default Region", description: "AWS region (e.g. us-east-1, us-west-2)", secret: false },
  ],
  envVars: { 
    access_key_id: "AWS_ACCESS_KEY_ID",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    region: "AWS_DEFAULT_REGION"
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` — use `aws` CLI and AWS SDKs directly",
};

export default awsCredentials;