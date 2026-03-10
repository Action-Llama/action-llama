/**
 * Shared AWS utilities used by both ECS Fargate and Lambda runtimes.
 *
 * Extracted from ECSFargateRuntime to avoid duplicating CodeBuild,
 * ECR, Secrets Manager, and S3 logic across runtimes.
 */

import { execFileSync } from "child_process";
import { createReadStream } from "fs";
import {
  SecretsManagerClient,
  ListSecretsCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  FilterLogEventsCommand,
  CreateLogGroupCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
  CreateProjectCommand,
} from "@aws-sdk/client-codebuild";
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import {
  ECRClient,
  BatchGetImageCommand,
} from "@aws-sdk/client-ecr";
import { parseCredentialRef, sanitizeEnvPart } from "../shared/credentials.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import type { RuntimeCredentials, SecretMount, BuildImageOpts } from "./runtime.js";

export interface AwsSharedConfig {
  awsRegion: string;
  ecrRepository: string;
  secretPrefix?: string;
  buildBucket?: string;
}

export class AwsSharedUtils {
  private config: AwsSharedConfig;
  private prefix: string;
  private smClient: SecretsManagerClient;
  private logsClient: CloudWatchLogsClient;
  private cbClient: CodeBuildClient;
  private s3Client: S3Client;
  private ecrClient: ECRClient;

  constructor(config: AwsSharedConfig) {
    this.config = config;
    this.prefix = config.secretPrefix || AWS_CONSTANTS.DEFAULT_SECRET_PREFIX;

    const clientConfig = { region: config.awsRegion };
    this.smClient = new SecretsManagerClient(clientConfig);
    this.logsClient = new CloudWatchLogsClient(clientConfig);
    this.cbClient = new CodeBuildClient(clientConfig);
    this.s3Client = new S3Client(clientConfig);
    this.ecrClient = new ECRClient(clientConfig);
  }

  // --- Account ID ---

  getAccountId(): string {
    const match = this.config.ecrRepository.match(/^(\d+)\.dkr\.ecr\./);
    return match?.[1] || "";
  }

  // --- Secrets Manager ---

  awsSecretName(type: string, instance: string, field: string): string {
    return `${this.prefix}/${type}/${instance}/${field}`;
  }

  async listSecretFields(type: string, instance: string): Promise<string[]> {
    const prefix = `${this.prefix}/${type}/${instance}/`;

    const res = await this.smClient.send(new ListSecretsCommand({
      Filters: [{ Key: "name", Values: [prefix] }],
      MaxResults: 100,
    }));

    const fields: string[] = [];
    for (const secret of res.SecretList || []) {
      if (secret.Name?.startsWith(prefix)) {
        fields.push(secret.Name.slice(prefix.length));
      }
    }

    return fields;
  }

  async prepareCredentials(credRefs: string[]): Promise<RuntimeCredentials> {
    const mounts: SecretMount[] = [];

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await this.listSecretFields(type, instance);

      for (const field of fields) {
        const secretName = this.awsSecretName(type, instance, field);
        mounts.push({
          secretId: secretName,
          mountPath: `/credentials/${type}/${instance}/${field}`,
        });
      }
    }

    return { strategy: "secrets-manager", mounts };
  }

  /**
   * Resolve secret values from Secrets Manager and return them as env var entries.
   * Used by Lambda to pass secrets as environment variables.
   */
  async resolveSecretValues(credRefs: string[]): Promise<Record<string, string>> {
    const env: Record<string, string> = {};

    for (const credRef of credRefs) {
      const { type, instance } = parseCredentialRef(credRef);
      const fields = await this.listSecretFields(type, instance);

      for (const field of fields) {
        const secretName = this.awsSecretName(type, instance, field);
        const envName = `AL_SECRET_${sanitizeEnvPart(type)}__${sanitizeEnvPart(instance)}__${sanitizeEnvPart(field)}`;
        try {
          const res = await this.smClient.send(new GetSecretValueCommand({
            SecretId: secretName,
          }));
          if (res.SecretString) {
            env[envName] = res.SecretString;
          }
        } catch (err: any) {
          if (err.name !== "ResourceNotFoundException") throw err;
        }
      }
    }

    return env;
  }

  // --- ECR ---

  async ecrImageExists(repositoryName: string, imageTag: string, onProgress?: (message: string) => void): Promise<boolean> {
    try {
      const res = await this.ecrClient.send(new BatchGetImageCommand({
        repositoryName,
        imageIds: [{ imageTag }],
      }));
      return (res.images?.length ?? 0) > 0;
    } catch (err: any) {
      if (err.name === "ImageNotFoundException") return false;
      onProgress?.(`Cache check failed: ${err.message ?? err}`);
      return false;
    }
  }

  // --- S3 ---

  async ensureBuildBucket(): Promise<string> {
    if (this.config.buildBucket) {
      return this.config.buildBucket;
    }

    const accountId = this.getAccountId();
    const bucket = AWS_CONSTANTS.buildBucket(accountId, this.config.awsRegion);

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } else if (err.name !== "Forbidden") {
        throw err;
      }
    }

    return bucket;
  }

  // --- CodeBuild ---

  async ensureCodeBuildProject(projectName: string, bucket: string): Promise<void> {
    const accountId = this.getAccountId();

    try {
      const status = await this.cbClient.send(new BatchGetBuildsCommand({ ids: [`${projectName}:dummy`] }));
      void status;
    } catch {}

    const serviceRole = `arn:aws:iam::${accountId}:role/${AWS_CONSTANTS.CODEBUILD_ROLE}`;

    try {
      await this.cbClient.send(new CreateProjectCommand({
        name: projectName,
        source: {
          type: "S3",
          location: `${bucket}/`,
        },
        artifacts: { type: "NO_ARTIFACTS" },
        environment: {
          type: "LINUX_CONTAINER",
          computeType: "BUILD_GENERAL1_MEDIUM",
          image: "aws/codebuild/standard:7.0",
          privilegedMode: true,
          environmentVariables: [
            { name: "IMAGE_URI", value: "placeholder" },
            { name: "ECR_REGISTRY", value: "placeholder" },
            { name: "DOCKERFILE", value: "Dockerfile" },
          ],
        },
        serviceRole,
      }));
    } catch (err: any) {
      if (err.name !== "ResourceAlreadyExistsException") {
        throw err;
      }
    }
  }

  async buildImageCodeBuild(opts: BuildImageOpts, onProgress?: (message: string) => void): Promise<string> {
    onProgress?.("Preparing build context");

    const { join, relative, isAbsolute } = await import("path");
    const { readFileSync, writeFileSync, mkdirSync } = await import("fs");
    const { randomUUID, createHash } = await import("crypto");

    const hasExtraFiles = opts.extraFiles && Object.keys(opts.extraFiles).length > 0;
    let dockerfileTar: string;
    let tempDockerfile: string | undefined;

    if (opts.dockerfileContent) {
      // Inline Dockerfile content — write directly to a temp file
      tempDockerfile = join(opts.contextDir, `.Dockerfile.${randomUUID().slice(0, 8)}`);
      writeFileSync(tempDockerfile, opts.dockerfileContent);
      dockerfileTar = relative(opts.contextDir, tempDockerfile);
    } else {
      const resolvedDockerfile = isAbsolute(opts.dockerfile)
        ? opts.dockerfile
        : join(opts.contextDir, opts.dockerfile);
      const relPath = relative(opts.contextDir, resolvedDockerfile);

      const needsCopy = relPath.startsWith("..");
      const needsRewrite = !!opts.baseImage;

      // Extra files require a temp Dockerfile to add COPY instructions
      if (needsCopy || needsRewrite || hasExtraFiles) {
        tempDockerfile = join(opts.contextDir, `.Dockerfile.${randomUUID().slice(0, 8)}`);
        let content = readFileSync(resolvedDockerfile, "utf-8");
        if (needsRewrite && opts.baseImage) {
          content = content.replace(
            /^FROM\s+\S+/m,
            `FROM ${opts.baseImage}`,
          );
        }
        if (hasExtraFiles) {
          // Insert COPY before USER directive so files are owned by root (readable by node)
          const copyLine = "COPY static/ /app/static/";
          const userIdx = content.indexOf("\nUSER ");
          if (userIdx !== -1) {
            content = content.slice(0, userIdx) + "\n" + copyLine + content.slice(userIdx);
          } else {
            content += "\n" + copyLine + "\n";
          }
        }
        writeFileSync(tempDockerfile, content);
        dockerfileTar = relative(opts.contextDir, tempDockerfile);
      } else {
        dockerfileTar = relPath;
      }
    }

    // Write extra files to static/ directory in the build context
    const staticDir = join(opts.contextDir, "static");
    if (hasExtraFiles) {
      mkdirSync(staticDir, { recursive: true });
      for (const [filename, content] of Object.entries(opts.extraFiles!)) {
        writeFileSync(join(staticDir, filename), content);
      }
    }

    const { readdirSync, readFileSync: readFileSyncBuf } = await import("fs");
    const hash = createHash("sha256");

    const hashFile = (p: string) => {
      hash.update(p);
      hash.update(readFileSyncBuf(join(opts.contextDir, p)));
    };
    const hashDir = (dir: string) => {
      const entries = readdirSync(join(opts.contextDir, dir), { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) hashDir(p);
        else hashFile(p);
      }
    };

    // Use a stable name for the Dockerfile hash key so temp filenames
    // (which contain a random UUID) don't bust the cache.
    hash.update("Dockerfile");
    hash.update(readFileSyncBuf(join(opts.contextDir, dockerfileTar)));
    if (!opts.dockerfileContent) {
      // Full image build: hash the application files
      hashFile("package.json");
      hashDir("dist");
    }
    if (hasExtraFiles) {
      hashDir("static");
    }

    const cleanupTempFiles = async () => {
      if (tempDockerfile) {
        try { const { rmSync } = await import("fs"); rmSync(tempDockerfile); } catch {}
      }
      if (hasExtraFiles) {
        try { const { rmSync } = await import("fs"); rmSync(staticDir, { recursive: true }); } catch {}
      }
    };

    await cleanupTempFiles();

    const contentHash = hash.digest("hex").slice(0, 16);
    const nameTag = opts.tag.replace(":", "-");
    const hashTag = `${nameTag}-${contentHash}`;
    const remoteTag = `${this.config.ecrRepository}:${hashTag}`;

    onProgress?.(`Checking cache (${hashTag})`);
    const repoName = this.config.ecrRepository.split("/").pop()!;
    const imageExists = await this.ecrImageExists(repoName, hashTag, onProgress);

    if (imageExists) {
      onProgress?.("Image unchanged — reusing cached build");
      return remoteTag;
    }

    onProgress?.("Cache miss — building image");

    // Re-create temp files for the actual build (they were cleaned up after hashing)
    if (opts.dockerfileContent) {
      tempDockerfile = join(opts.contextDir, `.Dockerfile.${randomUUID().slice(0, 8)}`);
      writeFileSync(tempDockerfile, opts.dockerfileContent);
      dockerfileTar = relative(opts.contextDir, tempDockerfile);
    } else {
      const resolvedDockerfile2 = isAbsolute(opts.dockerfile)
        ? opts.dockerfile
        : join(opts.contextDir, opts.dockerfile);
      const relPath2 = relative(opts.contextDir, resolvedDockerfile2);
      const needsCopy2 = relPath2.startsWith("..");
      const needsRewrite2 = !!opts.baseImage;

      if (needsCopy2 || needsRewrite2 || hasExtraFiles) {
        tempDockerfile = join(opts.contextDir, `.Dockerfile.${randomUUID().slice(0, 8)}`);
        let content = readFileSync(resolvedDockerfile2, "utf-8");
        if (needsRewrite2 && opts.baseImage) {
          content = content.replace(
            /^FROM\s+\S+/m,
            `FROM ${opts.baseImage}`,
          );
        }
        if (hasExtraFiles) {
          const copyLine = "COPY static/ /app/static/";
          const userIdx = content.indexOf("\nUSER ");
          if (userIdx !== -1) {
            content = content.slice(0, userIdx) + "\n" + copyLine + content.slice(userIdx);
          } else {
            content += "\n" + copyLine + "\n";
          }
        }
        writeFileSync(tempDockerfile, content);
        dockerfileTar = relative(opts.contextDir, tempDockerfile);
      }
    }

    if (hasExtraFiles) {
      mkdirSync(staticDir, { recursive: true });
      for (const [filename, content] of Object.entries(opts.extraFiles!)) {
        writeFileSync(join(staticDir, filename), content);
      }
    }

    const { tmpdir } = await import("os");
    const tarPath = join(tmpdir(), `${AWS_CONSTANTS.BUILD_S3_PREFIX}-${randomUUID().slice(0, 8)}.tar.gz`);

    const tarEntries = [dockerfileTar];
    if (!opts.dockerfileContent) {
      // Full image build: include application files
      tarEntries.push("package.json", "dist");
    }
    if (hasExtraFiles) {
      tarEntries.push("static");
    }

    try {
      execFileSync("tar", [
        "czf", tarPath,
        "-C", opts.contextDir,
        ...tarEntries,
      ], {
        encoding: "utf-8",
        timeout: 60_000,
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
    } finally {
      if (tempDockerfile) {
        try { const { rmSync } = await import("fs"); rmSync(tempDockerfile); } catch {}
      }
      if (hasExtraFiles) {
        try { const { rmSync } = await import("fs"); rmSync(staticDir, { recursive: true }); } catch {}
      }
    }

    onProgress?.("Uploading to S3");
    const bucket = await this.ensureBuildBucket();
    const s3Key = `${AWS_CONSTANTS.BUILD_S3_PREFIX}/${nameTag}-${Date.now()}.tar.gz`;
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: createReadStream(tarPath),
    }));

    try { const { rmSync } = await import("fs"); rmSync(tarPath); } catch {}

    const projectName = AWS_CONSTANTS.CODEBUILD_PROJECT;
    await this.ensureCodeBuildProject(projectName, bucket);
    const registry = this.config.ecrRepository.split("/")[0];

    const buildspec = [
      "version: 0.2",
      "phases:",
      "  pre_build:",
      "    commands:",
      "      - tar xzf *.tar.gz && rm -f *.tar.gz",
      "      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY",
      "  build:",
      "    commands:",
      "      - docker build -t $IMAGE_URI -f $DOCKERFILE .",
      "      - docker push $IMAGE_URI",
    ].join("\n");

    const buildRes = await this.cbClient.send(new StartBuildCommand({
      projectName,
      sourceTypeOverride: "S3",
      sourceLocationOverride: `${bucket}/${s3Key}`,
      buildspecOverride: buildspec,
      environmentVariablesOverride: [
        { name: "IMAGE_URI", value: remoteTag },
        { name: "ECR_REGISTRY", value: registry },
        { name: "DOCKERFILE", value: dockerfileTar },
      ],
    }));

    const buildId = buildRes.build?.id;
    if (!buildId) throw new Error("CodeBuild did not return a build ID");

    onProgress?.("Queued — waiting for CodeBuild");

    while (true) {
      await sleep(10_000);

      const status = await this.cbClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = status.builds?.[0];
      if (!build) throw new Error(`CodeBuild build ${buildId} not found`);

      if (build.currentPhase) {
        const phaseLabels: Record<string, string> = {
          SUBMITTED: "Submitted",
          QUEUED: "Queued",
          PROVISIONING: "Provisioning build environment",
          DOWNLOAD_SOURCE: "Downloading source",
          INSTALL: "Installing dependencies",
          PRE_BUILD: "Logging in to ECR",
          BUILD: "Building and pushing image",
          POST_BUILD: "Finalizing",
          UPLOAD_ARTIFACTS: "Uploading artifacts",
          FINALIZING: "Finalizing",
          COMPLETED: "Complete",
        };
        const label = phaseLabels[build.currentPhase] || build.currentPhase;
        onProgress?.(label);
      }

      if (build.buildComplete) {
        if (build.buildStatus !== "SUCCEEDED") {
          const logs = build.logs?.deepLink || "";
          throw new Error(`CodeBuild build failed (${build.buildStatus}). Logs: ${logs}`);
        }
        return remoteTag;
      }
    }
  }

  // --- CloudWatch Logs ---

  private logGroupsCreated = new Set<string>();

  async ensureLogGroup(logGroupName: string): Promise<void> {
    if (this.logGroupsCreated.has(logGroupName)) return;
    try {
      await this.logsClient.send(new CreateLogGroupCommand({ logGroupName }));
    } catch (err: any) {
      if (err.name !== "ResourceAlreadyExistsException") throw err;
    }
    this.logGroupsCreated.add(logGroupName);
  }

  async getLogEvents(
    logGroup: string,
    logStream: string,
    nextToken?: string
  ): Promise<{ events: Array<{ message: string }>; nextForwardToken?: string }> {
    const res = await this.logsClient.send(new GetLogEventsCommand({
      logGroupName: logGroup,
      logStreamName: logStream,
      startFromHead: true,
      nextToken,
    }));

    return {
      events: (res.events || []).map((e) => ({ message: e.message?.trimEnd() || "" })),
      nextForwardToken: res.nextForwardToken,
    };
  }

  async filterLogEvents(logGroupName: string, logStreamPrefix: string, limit: number): Promise<string[]> {
    const res = await this.logsClient.send(new FilterLogEventsCommand({
      logGroupName,
      logStreamNamePrefix: logStreamPrefix,
      limit,
    }));

    return (res.events ?? [])
      .map((e) => e.message?.trimEnd() ?? "")
      .filter(Boolean);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
