import type { CredentialDefinition } from "../schema.js";

const awsCredentials: CredentialDefinition = {
  id: "aws_credentials",
  label: "AWS Credentials",
  description: "Access credentials for AWS services",
  helpUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
  fields: [
    { 
      name: "access_key_id", 
      label: "Access Key ID", 
      description: "AWS access key ID (AKIA...)", 
      secret: false 
    },
    { 
      name: "secret_access_key", 
      label: "Secret Access Key", 
      description: "AWS secret access key", 
      secret: true 
    },
    { 
      name: "default_region", 
      label: "Default Region", 
      description: "Default AWS region (e.g., us-east-1)", 
      secret: false 
    },
  ],
  envVars: {
    access_key_id: "AWS_ACCESS_KEY_ID",
    secret_access_key: "AWS_SECRET_ACCESS_KEY",
    default_region: "AWS_DEFAULT_REGION",
  },
  agentContext: "`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` — use AWS CLI and SDKs",
};

export default awsCredentials;