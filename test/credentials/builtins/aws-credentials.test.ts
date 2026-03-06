import { describe, it, expect } from "vitest";
import awsCredentials from "../../../src/credentials/builtins/aws-credentials.js";

describe("aws-credentials", () => {
  it("should have correct id and labels", () => {
    expect(awsCredentials.id).toBe("aws_credentials");
    expect(awsCredentials.label).toBe("AWS Credentials");
    expect(awsCredentials.description).toBe("Access credentials for AWS services");
  });

  it("should have correct fields", () => {
    expect(awsCredentials.fields).toHaveLength(3);
    
    const accessKeyField = awsCredentials.fields.find(f => f.name === "access_key_id");
    expect(accessKeyField).toBeDefined();
    expect(accessKeyField?.label).toBe("Access Key ID");
    expect(accessKeyField?.secret).toBe(false);
    
    const secretKeyField = awsCredentials.fields.find(f => f.name === "secret_access_key");
    expect(secretKeyField).toBeDefined();
    expect(secretKeyField?.label).toBe("Secret Access Key");
    expect(secretKeyField?.secret).toBe(true);
    
    const regionField = awsCredentials.fields.find(f => f.name === "default_region");
    expect(regionField).toBeDefined();
    expect(regionField?.label).toBe("Default Region");
    expect(regionField?.secret).toBe(false);
  });

  it("should have correct env var mappings", () => {
    expect(awsCredentials.envVars).toEqual({
      access_key_id: "AWS_ACCESS_KEY_ID",
      secret_access_key: "AWS_SECRET_ACCESS_KEY",
      default_region: "AWS_DEFAULT_REGION",
    });
  });

  it("should have agent context", () => {
    expect(awsCredentials.agentContext).toContain("AWS_ACCESS_KEY_ID");
    expect(awsCredentials.agentContext).toContain("AWS_SECRET_ACCESS_KEY");
    expect(awsCredentials.agentContext).toContain("AWS_DEFAULT_REGION");
  });

  it("should have help URL", () => {
    expect(awsCredentials.helpUrl).toBe("https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html");
  });
});