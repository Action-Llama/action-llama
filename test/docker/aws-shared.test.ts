import { describe, it, expect, vi, beforeEach } from "vitest";
import { AwsSharedUtils } from "../../src/docker/aws-shared.js";

// Mock credentials module
vi.mock("../../src/shared/credentials.js", () => ({
  parseCredentialRef: (ref: string) => {
    const sep = ref.indexOf(":");
    if (sep === -1) return { type: ref, instance: "default" };
    return { type: ref.slice(0, sep).trim(), instance: ref.slice(sep + 1).trim() };
  },
  sanitizeEnvPart: (part: string) => part.replace(/[^a-zA-Z0-9_]/g, (ch: string) =>
    `_x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`),
}));

const mockSmSend = vi.fn();
const mockLogsSend = vi.fn();
const mockCbSend = vi.fn();
const mockS3Send = vi.fn();
const mockEcrSend = vi.fn();

vi.mock("@aws-sdk/client-secrets-manager", () => {
  const SecretsManagerClient = vi.fn(function (this: any) { this.send = mockSmSend; });
  const ListSecretsCommand = vi.fn(function (this: any, input: any) { this._type = "ListSecrets"; this.input = input; });
  const GetSecretValueCommand = vi.fn(function (this: any, input: any) { this._type = "GetSecretValue"; this.input = input; });
  return { SecretsManagerClient, ListSecretsCommand, GetSecretValueCommand };
});

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  const CloudWatchLogsClient = vi.fn(function (this: any) { this.send = mockLogsSend; });
  const GetLogEventsCommand = vi.fn(function (this: any, input: any) { this._type = "GetLogEvents"; this.input = input; });
  const FilterLogEventsCommand = vi.fn(function (this: any, input: any) { this._type = "FilterLogEvents"; this.input = input; });
  const CreateLogGroupCommand = vi.fn(function (this: any, input: any) { this._type = "CreateLogGroup"; this.input = input; });
  return { CloudWatchLogsClient, GetLogEventsCommand, FilterLogEventsCommand, CreateLogGroupCommand };
});

vi.mock("@aws-sdk/client-codebuild", () => {
  const CodeBuildClient = vi.fn(function (this: any) { this.send = mockCbSend; });
  const StartBuildCommand = vi.fn(function (this: any, input: any) { this._type = "StartBuild"; this.input = input; });
  const BatchGetBuildsCommand = vi.fn(function (this: any, input: any) { this._type = "BatchGetBuilds"; this.input = input; });
  const CreateProjectCommand = vi.fn(function (this: any, input: any) { this._type = "CreateProject"; this.input = input; });
  return { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand, CreateProjectCommand };
});

vi.mock("@aws-sdk/client-s3", () => {
  const S3Client = vi.fn(function (this: any) { this.send = mockS3Send; });
  const PutObjectCommand = vi.fn(function (this: any, input: any) { this._type = "PutObject"; this.input = input; });
  const CreateBucketCommand = vi.fn(function (this: any, input: any) { this._type = "CreateBucket"; this.input = input; });
  const HeadBucketCommand = vi.fn(function (this: any, input: any) { this._type = "HeadBucket"; this.input = input; });
  return { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand };
});

vi.mock("@aws-sdk/client-ecr", () => {
  const ECRClient = vi.fn(function (this: any) { this.send = mockEcrSend; });
  const BatchGetImageCommand = vi.fn(function (this: any, input: any) { this._type = "BatchGetImage"; this.input = input; });
  return { ECRClient, BatchGetImageCommand };
});

vi.mock("child_process", () => ({
  execFileSync: vi.fn((_cmd: string, _args: string[]) => ""),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, createReadStream: vi.fn(() => "mock-stream") };
});

const defaultConfig = {
  awsRegion: "us-east-1",
  ecrRepository: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images",
  secretPrefix: "action-llama",
};

describe("AwsSharedUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts account ID from ECR repository URI", () => {
    const utils = new AwsSharedUtils(defaultConfig);
    expect(utils.getAccountId()).toBe("123456789012");
  });

  it("returns empty string for non-standard ECR URI", () => {
    const utils = new AwsSharedUtils({
      ...defaultConfig,
      ecrRepository: "custom-registry/al-images",
    });
    expect(utils.getAccountId()).toBe("");
  });

  it("prepareCredentials maps credential refs to secrets-manager mounts", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    mockSmSend.mockResolvedValueOnce({
      SecretList: [
        { Name: "action-llama/github_token/default/token" },
        { Name: "action-llama/github_token/default/username" },
      ],
    });

    const creds = await utils.prepareCredentials(["github_token:default"]);
    expect(creds.strategy).toBe("secrets-manager");
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts).toHaveLength(2);
      expect(creds.mounts[0].secretId).toBe("action-llama/github_token/default/token");
      expect(creds.mounts[1].secretId).toBe("action-llama/github_token/default/username");
    }
  });

  it("prepareCredentials uses custom secret prefix", async () => {
    const utils = new AwsSharedUtils({ ...defaultConfig, secretPrefix: "myapp" });

    mockSmSend.mockResolvedValueOnce({
      SecretList: [{ Name: "myapp/api_key/default/key" }],
    });

    const creds = await utils.prepareCredentials(["api_key:default"]);
    if (creds.strategy === "secrets-manager") {
      expect(creds.mounts[0].secretId).toBe("myapp/api_key/default/key");
    }
  });

  it("resolveSecretValues fetches actual secret values", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    // ListSecrets
    mockSmSend.mockResolvedValueOnce({
      SecretList: [{ Name: "action-llama/github_token/default/token" }],
    });
    // GetSecretValue
    mockSmSend.mockResolvedValueOnce({
      SecretString: "ghp_test_token_123",
    });

    const env = await utils.resolveSecretValues(["github_token:default"]);
    expect(env).toEqual({
      AL_SECRET_github_token__default__token: "ghp_test_token_123",
    });
  });

  it("resolveSecretValues handles missing secrets gracefully", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    // ListSecrets returns a secret
    mockSmSend.mockResolvedValueOnce({
      SecretList: [{ Name: "action-llama/api_key/default/key" }],
    });
    // GetSecretValue → not found
    mockSmSend.mockRejectedValueOnce({ name: "ResourceNotFoundException" });

    const env = await utils.resolveSecretValues(["api_key:default"]);
    expect(env).toEqual({});
  });

  it("ecrImageExists returns true when image exists", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    mockEcrSend.mockResolvedValueOnce({
      images: [{ imageId: { imageTag: "test-tag" } }],
    });

    const exists = await utils.ecrImageExists("al-images", "test-tag");
    expect(exists).toBe(true);
  });

  it("ecrImageExists returns false when image not found", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    mockEcrSend.mockRejectedValueOnce({ name: "ImageNotFoundException" });

    const exists = await utils.ecrImageExists("al-images", "missing-tag");
    expect(exists).toBe(false);
  });

  it("ensureLogGroup creates log group idempotently", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    // First call: creates
    mockLogsSend.mockResolvedValueOnce({});
    await utils.ensureLogGroup("/ecs/action-llama");

    // Second call: already exists (cached)
    await utils.ensureLogGroup("/ecs/action-llama");

    // Only one CreateLogGroup call (cached on second)
    expect(mockLogsSend).toHaveBeenCalledTimes(1);
  });

  it("ensureLogGroup handles already-exists error", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    mockLogsSend.mockRejectedValueOnce({ name: "ResourceAlreadyExistsException" });
    await utils.ensureLogGroup("/test-group");
    // Should not throw
  });

  it("filterLogEvents returns formatted log lines", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    mockLogsSend.mockResolvedValueOnce({
      events: [
        { message: "line 1  " },
        { message: "line 2  " },
        { message: "   " },
      ],
    });

    const lines = await utils.filterLogEvents("/test-group", "prefix/", 10);
    expect(lines).toEqual(["line 1", "line 2"]);
  });

  it("ensureBuildBucket uses configured bucket", async () => {
    const utils = new AwsSharedUtils({
      ...defaultConfig,
      buildBucket: "my-custom-bucket",
    });

    const bucket = await utils.ensureBuildBucket();
    expect(bucket).toBe("my-custom-bucket");
    // No S3 calls needed
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("ensureBuildBucket creates bucket when not found", async () => {
    const utils = new AwsSharedUtils(defaultConfig);

    // HeadBucket → not found
    mockS3Send.mockRejectedValueOnce({ name: "NotFound" });
    // CreateBucket
    mockS3Send.mockResolvedValueOnce({});

    const bucket = await utils.ensureBuildBucket();
    expect(bucket).toBe("al-builds-123456789012-us-east-1");
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  describe("buildImageCodeBuild cache hash stability", () => {
    let contextDir: string;

    beforeEach(async () => {
      const { mkdtempSync, mkdirSync, writeFileSync: wfs } = await import("fs");
      const { join } = await import("path");
      const os = await import("os");
      contextDir = mkdtempSync(join(os.tmpdir(), "al-cache-test-"));
      wfs(join(contextDir, "Dockerfile"), "FROM al-agent:latest\nRUN echo hello\n");
      wfs(join(contextDir, "package.json"), '{"name":"test"}');
      mkdirSync(join(contextDir, "dist"));
      wfs(join(contextDir, "dist", "index.js"), "console.log('hi')");
    });

    it("produces the same hash tag across repeated calls with baseImage", async () => {
      const utils = new AwsSharedUtils(defaultConfig);

      // Both calls: ECR returns cache hit so we get back the tag without needing
      // S3/CodeBuild mocks
      mockEcrSend.mockResolvedValue({ images: [{ imageId: { imageTag: "x" } }] });

      const opts = {
        tag: "al-agent:latest",
        dockerfile: "Dockerfile",
        contextDir,
        baseImage: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:base",
      };

      const tag1 = await utils.buildImageCodeBuild(opts);
      const tag2 = await utils.buildImageCodeBuild(opts);

      expect(tag1).toBe(tag2);
    });

    it("produces different hash tags when file content changes", async () => {
      const utils = new AwsSharedUtils(defaultConfig);
      const { writeFileSync: wfs } = await import("fs");
      const { join } = await import("path");

      mockEcrSend.mockResolvedValue({ images: [{ imageId: { imageTag: "x" } }] });

      const opts = {
        tag: "al-agent:latest",
        dockerfile: "Dockerfile",
        contextDir,
        baseImage: "123456789012.dkr.ecr.us-east-1.amazonaws.com/al-images:base",
      };

      const tag1 = await utils.buildImageCodeBuild(opts);

      // Change a file
      wfs(join(contextDir, "dist", "index.js"), "console.log('changed')");

      const tag2 = await utils.buildImageCodeBuild(opts);

      expect(tag1).not.toBe(tag2);
    });
  });
});
