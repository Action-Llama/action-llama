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
  UpdateProjectCommand,
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
  PutImageCommand,
  GetDownloadUrlForLayerCommand,
  InitiateLayerUploadCommand,
  UploadLayerPartCommand,
  CompleteLayerUploadCommand,
} from "@aws-sdk/client-ecr";
import { parseCredentialRef, sanitizeEnvPart } from "../shared/credentials.js";
import { CONSTANTS } from "../shared/constants.js";
import { AWS_CONSTANTS } from "../cloud/aws/constants.js";
import type { RuntimeCredentials, SecretMount, BuildImageOpts, AssembleImageOpts } from "./runtime.js";

const HASH_EXCLUDED = [/\.DS_Store$/, /Thumbs\.db$/, /\.d\.ts$/, /\.d\.ts\.map$/, /\.js\.map$/, /\.tsbuildinfo$/];

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
    this.prefix = config.secretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX;

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

    // Phase 1: list all fields in parallel
    const parsed = credRefs.map((ref) => parseCredentialRef(ref));
    const fieldResults = await Promise.all(
      parsed.map(({ type, instance }) => this.listSecretFields(type, instance)),
    );

    // Phase 2: fetch all secret values in parallel
    const fetchOps: Array<{ envName: string; secretName: string }> = [];
    for (let i = 0; i < parsed.length; i++) {
      const { type, instance } = parsed[i];
      for (const field of fieldResults[i]) {
        fetchOps.push({
          envName: `AL_SECRET_${sanitizeEnvPart(type)}__${sanitizeEnvPart(instance)}__${sanitizeEnvPart(field)}`,
          secretName: this.awsSecretName(type, instance, field),
        });
      }
    }

    const values = await Promise.all(
      fetchOps.map(async ({ secretName }) => {
        try {
          const res = await this.smClient.send(new GetSecretValueCommand({
            SecretId: secretName,
          }));
          return res.SecretString ?? null;
        } catch (err: any) {
          if (err.name !== "ResourceNotFoundException") throw err;
          return null;
        }
      }),
    );

    for (let i = 0; i < fetchOps.length; i++) {
      if (values[i] !== null) {
        env[fetchOps[i].envName] = values[i]!;
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
    const cache = { type: "LOCAL" as const, modes: ["LOCAL_DOCKER_LAYER_CACHE" as const] };

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
        cache,
        serviceRole,
      }));
    } catch (err: any) {
      if (err.name !== "ResourceAlreadyExistsException") {
        throw err;
      }
      // Project exists — ensure cache config is applied
      try {
        await this.cbClient.send(new UpdateProjectCommand({
          name: projectName,
          cache,
        }));
      } catch {
        // Best-effort — build still works without local cache
      }
    }
  }

  async buildImageCodeBuild(opts: BuildImageOpts, onProgress?: (message: string) => void): Promise<string> {
    onProgress?.("Preparing build context");

    const { join, relative, isAbsolute } = await import("path");
    const { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync } = await import("fs");
    const { randomUUID, createHash } = await import("crypto");
    const { tmpdir } = await import("os");

    const hasExtraFiles = opts.extraFiles && Object.keys(opts.extraFiles).length > 0;

    // Use an isolated temp directory for the build context so parallel builds
    // don't race on shared files (e.g. static/ directory in packageRoot).
    const buildCtx = join(tmpdir(), `al-ctx-${randomUUID().slice(0, 8)}`);
    mkdirSync(buildCtx, { recursive: true });

    // Prepare Dockerfile
    let dockerfileContent: string;
    if (opts.dockerfileContent) {
      dockerfileContent = opts.dockerfileContent;
    } else {
      const resolvedDockerfile = isAbsolute(opts.dockerfile)
        ? opts.dockerfile
        : join(opts.contextDir, opts.dockerfile);
      dockerfileContent = readFileSync(resolvedDockerfile, "utf-8");
      if (opts.baseImage) {
        dockerfileContent = dockerfileContent.replace(
          /^FROM\s+\S+/m,
          `FROM ${opts.baseImage}`,
        );
      }
    }
    if (hasExtraFiles && !dockerfileContent.includes("COPY static/ /app/static/")) {
      // Insert COPY before USER directive so files are owned by root (readable by node)
      const copyLine = "COPY static/ /app/static/";
      const userIdx = dockerfileContent.indexOf("\nUSER ");
      if (userIdx !== -1) {
        dockerfileContent = dockerfileContent.slice(0, userIdx) + "\n" + copyLine + dockerfileContent.slice(userIdx);
      } else {
        dockerfileContent += "\n" + copyLine + "\n";
      }
    }
    writeFileSync(join(buildCtx, "Dockerfile"), dockerfileContent);

    // For full builds, copy application files into the build context
    if (!opts.dockerfileContent) {
      const { lstatSync } = await import("fs");
      const cpFilter = (source: string) => {
        try { if (lstatSync(source).isDirectory()) return true; } catch { return true; }
        return !HASH_EXCLUDED.some(re => re.test(source));
      };

      copyFileSync(join(opts.contextDir, "package.json"), join(buildCtx, "package.json"));
      cpSync(join(opts.contextDir, "dist"), join(buildCtx, "dist"), { recursive: true, filter: cpFilter });
      // Copy baked shell scripts (docker/bin/) into the build context
      const binSrc = join(opts.contextDir, "docker", "bin");
      if (existsSync(binSrc)) {
        cpSync(binSrc, join(buildCtx, "docker", "bin"), { recursive: true, filter: cpFilter });
      }
    }

    // Write extra files to static/ directory
    if (hasExtraFiles) {
      const staticDir = join(buildCtx, "static");
      mkdirSync(staticDir, { recursive: true });
      for (const [filename, content] of Object.entries(opts.extraFiles!)) {
        const filePath = join(staticDir, filename);
        const { dirname: dirnameFn } = await import("path");
        mkdirSync(dirnameFn(filePath), { recursive: true });
        writeFileSync(filePath, content);
      }
    }

    // Compute content hash for cache key
    const { readdirSync, readFileSync: readFileSyncBuf } = await import("fs");
    const hash = createHash("sha256");

    const hashFile = (p: string) => {
      if (HASH_EXCLUDED.some(re => re.test(p))) return;
      hash.update(p);
      hash.update(readFileSyncBuf(join(buildCtx, p)));
    };
    const hashDir = (dir: string) => {
      const entries = readdirSync(join(buildCtx, dir), { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) hashDir(p);
        else hashFile(p);
      }
    };

    // Use a stable name for the Dockerfile hash key so temp filenames don't bust the cache.
    hash.update("Dockerfile");
    hash.update(readFileSyncBuf(join(buildCtx, "Dockerfile")));
    if (!opts.dockerfileContent) {
      hashFile("package.json");
      if (opts.useLockfileHash) {
        // Stable proxy for dist/ — same package + deps = same compiled output
        const lockfilePath = join(opts.contextDir, "package-lock.json");
        if (existsSync(lockfilePath)) {
          hash.update("package-lock.json");
          hash.update(readFileSyncBuf(lockfilePath));
        }
      } else {
        hashDir("dist");
      }
      if (existsSync(join(buildCtx, "docker"))) {
        hashDir("docker");
      }
    }
    if (hasExtraFiles) {
      hashDir("static");
    }

    const contentHash = hash.digest("hex").slice(0, 16);
    const nameTag = opts.tag.replace(":", "-");
    const hashTag = `${nameTag}-${contentHash}`;
    const remoteTag = `${this.config.ecrRepository}:${hashTag}`;

    onProgress?.(`Checking cache (${hashTag})`);
    const repoName = this.config.ecrRepository.split("/").pop()!;
    const imageExists = await this.ecrImageExists(repoName, hashTag, onProgress);

    if (imageExists) {
      onProgress?.("Image unchanged — reusing cached build");
      try { const { rmSync } = await import("fs"); rmSync(buildCtx, { recursive: true }); } catch {}
      return remoteTag;
    }

    onProgress?.("Cache miss — building image");

    // Tar the build context
    const tarPath = join(tmpdir(), `${AWS_CONSTANTS.BUILD_S3_PREFIX}-${randomUUID().slice(0, 8)}.tar.gz`);

    const tarEntries = ["Dockerfile"];
    if (!opts.dockerfileContent) {
      tarEntries.push("package.json", "dist");
      if (existsSync(join(buildCtx, "docker"))) {
        tarEntries.push("docker");
      }
    }
    if (hasExtraFiles) {
      tarEntries.push("static");
    }

    try {
      execFileSync("tar", [
        "czf", tarPath,
        "-C", buildCtx,
        ...tarEntries,
      ], {
        encoding: "utf-8",
        timeout: 60_000,
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
    } finally {
      try { const { rmSync } = await import("fs"); rmSync(buildCtx, { recursive: true }); } catch {}
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

    const cacheTag = `${this.config.ecrRepository}:${nameTag}-cache`;

    const buildspec = [
      "version: 0.2",
      "phases:",
      "  pre_build:",
      "    commands:",
      // CodeBuild auto-extracts tar.gz S3 sources, but extract manually if the
      // archive is still present (e.g. when sourceType handling changes).
      "      - if ls *.tar.gz 1>/dev/null 2>&1; then tar xzf *.tar.gz && rm -f *.tar.gz; fi",
      "      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY",
      "      - docker pull $CACHE_TAG || true",
      "  build:",
      "    commands:",
      "      - ls -la",
      "      - docker build --cache-from $CACHE_TAG -t $IMAGE_URI -f $DOCKERFILE .",
      "      - docker push $IMAGE_URI",
      "      - docker tag $IMAGE_URI $CACHE_TAG",
      "      - docker push $CACHE_TAG",
    ].join("\n");

    const buildRes = await this.cbClient.send(new StartBuildCommand({
      projectName,
      sourceTypeOverride: "S3",
      sourceLocationOverride: `${bucket}/${s3Key}`,
      buildspecOverride: buildspec,
      environmentVariablesOverride: [
        { name: "IMAGE_URI", value: remoteTag },
        { name: "ECR_REGISTRY", value: registry },
        { name: "DOCKERFILE", value: "Dockerfile" },
        { name: "CACHE_TAG", value: cacheTag },
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

  // --- Direct image assembly (bypass CodeBuild for thin agents) ---

  async assembleImageDirect(opts: AssembleImageOpts): Promise<string> {
    const { join, dirname: dirnameFn } = await import("path");
    const { mkdirSync, writeFileSync, rmSync, readFileSync: readFileSyncBuf } = await import("fs");
    const { execFileSync } = await import("child_process");
    const { createHash, randomUUID } = await import("crypto");
    const { gzipSync } = await import("zlib");
    const { tmpdir } = await import("os");

    // Compute content hash for cache check
    const hash = createHash("sha256");
    hash.update(opts.baseImage);
    const sortedEntries = Object.entries(opts.extraFiles).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, content] of sortedEntries) {
      hash.update(name);
      hash.update(content);
    }
    const contentHash = hash.digest("hex").slice(0, 16);
    const nameTag = opts.tag.replace(":", "-");
    const hashTag = `${nameTag}-${contentHash}`;
    const remoteTag = `${this.config.ecrRepository}:${hashTag}`;
    const repoName = this.config.ecrRepository.split("/").pop()!;

    opts.onProgress?.(`Checking cache (${hashTag})`);
    const exists = await this.ecrImageExists(repoName, hashTag, opts.onProgress);
    if (exists) {
      opts.onProgress?.("Image unchanged — reusing cached build");
      return remoteTag;
    }

    opts.onProgress?.("Assembling image directly (no CodeBuild)");

    // Create temp dir with the layer structure: app/static/...
    const tmpDir = join(tmpdir(), `al-assemble-${randomUUID().slice(0, 8)}`);
    mkdirSync(join(tmpDir, "app", "static"), { recursive: true });

    for (const [filename, content] of Object.entries(opts.extraFiles)) {
      const filePath = join(tmpDir, "app", "static", filename);
      mkdirSync(dirnameFn(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }

    // Create layer tar via system tar (consistent with buildImageCodeBuild)
    const tarPath = join(tmpdir(), `al-layer-${randomUUID().slice(0, 8)}.tar`);
    try {
      execFileSync("tar", ["cf", tarPath, "-C", tmpDir, "app"], {
        timeout: 30_000,
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
    } finally {
      try { rmSync(tmpDir, { recursive: true }); } catch {}
    }

    const tarBuffer = readFileSyncBuf(tarPath);
    try { rmSync(tarPath); } catch {}
    const compressedLayer = gzipSync(tarBuffer);

    const layerDigest = `sha256:${createHash("sha256").update(compressedLayer).digest("hex")}`;
    const diffId = `sha256:${createHash("sha256").update(tarBuffer).digest("hex")}`;

    // Get base image manifest
    opts.onProgress?.("Fetching base image manifest");
    const baseTag = opts.baseImage.includes(":")
      ? opts.baseImage.split(":").pop()!
      : opts.baseImage;

    const baseRes = await this.ecrClient.send(new BatchGetImageCommand({
      repositoryName: repoName,
      imageIds: [{ imageTag: baseTag }],
    }));

    if (!baseRes.images?.length) throw new Error(`Base image ${baseTag} not found in ECR`);
    const manifest = JSON.parse(baseRes.images[0].imageManifest!);

    // Fetch config blob via pre-signed URL
    opts.onProgress?.("Fetching base image config");
    const configDigest = manifest.config.digest;
    const configDownload = await this.ecrClient.send(new GetDownloadUrlForLayerCommand({
      repositoryName: repoName,
      layerDigest: configDigest,
    }));
    const configRes = await fetch(configDownload.downloadUrl!);
    const configJson = JSON.parse(await configRes.text());

    // Extend config with our layer
    configJson.rootfs.diff_ids.push(diffId);
    configJson.history = configJson.history || [];
    configJson.history.push({
      created: new Date().toISOString(),
      created_by: "action-llama assembleImageDirect",
    });

    const newConfigBytes = Buffer.from(JSON.stringify(configJson));
    const newConfigDigest = `sha256:${createHash("sha256").update(newConfigBytes).digest("hex")}`;

    // Upload layer blob
    opts.onProgress?.("Uploading layer");
    await this.uploadBlob(repoName, layerDigest, compressedLayer);

    // Upload new config blob
    await this.uploadBlob(repoName, newConfigDigest, newConfigBytes);

    // Build and push new manifest
    const newManifest = {
      schemaVersion: manifest.schemaVersion,
      mediaType: manifest.mediaType,
      config: {
        mediaType: manifest.config.mediaType,
        size: newConfigBytes.length,
        digest: newConfigDigest,
      },
      layers: [
        ...manifest.layers,
        {
          mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
          size: compressedLayer.length,
          digest: layerDigest,
        },
      ],
    };

    opts.onProgress?.("Pushing image manifest");
    await this.ecrClient.send(new PutImageCommand({
      repositoryName: repoName,
      imageManifest: JSON.stringify(newManifest),
      imageTag: hashTag,
    }));

    return remoteTag;
  }

  private async uploadBlob(repoName: string, digest: string, data: Buffer | Uint8Array): Promise<void> {
    const initRes = await this.ecrClient.send(new InitiateLayerUploadCommand({
      repositoryName: repoName,
    }));

    await this.ecrClient.send(new UploadLayerPartCommand({
      repositoryName: repoName,
      uploadId: initRes.uploadId!,
      partFirstByte: 0,
      partLastByte: data.length - 1,
      layerPartBlob: new Uint8Array(data),
    }));

    await this.ecrClient.send(new CompleteLayerUploadCommand({
      repositoryName: repoName,
      uploadId: initRes.uploadId!,
      layerDigests: [digest],
    }));
  }

  // --- Batched CodeBuild (multiple images in one job) ---

  async buildMultipleImagesCodeBuild(
    builds: BuildImageOpts[],
    onProgress?: (message: string) => void,
  ): Promise<string[]> {
    if (builds.length === 0) return [];
    if (builds.length === 1) return [await this.buildImageCodeBuild(builds[0], onProgress)];

    const { join, isAbsolute, dirname: dirnameFn } = await import("path");
    const { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, rmSync, readdirSync, lstatSync } = await import("fs");
    const { createHash, randomUUID } = await import("crypto");
    const { tmpdir } = await import("os");
    const { execFileSync } = await import("child_process");

    onProgress?.(`Preparing ${builds.length} build contexts`);

    const combinedCtx = join(tmpdir(), `al-multi-ctx-${randomUUID().slice(0, 8)}`);
    mkdirSync(combinedCtx, { recursive: true });

    // Per-build info: compute hash, check cache, prepare context
    const buildInfos: Array<{
      idx: number;
      remoteTag: string;
      hashTag: string;
      nameTag: string;
      cached: boolean;
      subdir: string;
    }> = [];

    for (let i = 0; i < builds.length; i++) {
      const opts = builds[i];
      const subdir = `build-${i}`;
      const subPath = join(combinedCtx, subdir);
      mkdirSync(subPath, { recursive: true });

      const hasExtraFiles = opts.extraFiles && Object.keys(opts.extraFiles).length > 0;

      // Prepare Dockerfile
      let dockerfileContent: string;
      if (opts.dockerfileContent) {
        dockerfileContent = opts.dockerfileContent;
      } else {
        const resolvedDockerfile = isAbsolute(opts.dockerfile)
          ? opts.dockerfile
          : join(opts.contextDir, opts.dockerfile);
        dockerfileContent = readFileSync(resolvedDockerfile, "utf-8");
        if (opts.baseImage) {
          dockerfileContent = dockerfileContent.replace(/^FROM\s+\S+/m, `FROM ${opts.baseImage}`);
        }
      }
      if (hasExtraFiles && !dockerfileContent.includes("COPY static/ /app/static/")) {
        const copyLine = "COPY static/ /app/static/";
        const userIdx = dockerfileContent.indexOf("\nUSER ");
        if (userIdx !== -1) {
          dockerfileContent = dockerfileContent.slice(0, userIdx) + "\n" + copyLine + dockerfileContent.slice(userIdx);
        } else {
          dockerfileContent += "\n" + copyLine + "\n";
        }
      }
      writeFileSync(join(subPath, "Dockerfile"), dockerfileContent);

      if (!opts.dockerfileContent) {
        const cpFilter = (source: string) => {
          try { if (lstatSync(source).isDirectory()) return true; } catch { return true; }
          return !HASH_EXCLUDED.some(re => re.test(source));
        };

        copyFileSync(join(opts.contextDir, "package.json"), join(subPath, "package.json"));
        cpSync(join(opts.contextDir, "dist"), join(subPath, "dist"), { recursive: true, filter: cpFilter });
        const binSrc = join(opts.contextDir, "docker", "bin");
        if (existsSync(binSrc)) {
          cpSync(binSrc, join(subPath, "docker", "bin"), { recursive: true, filter: cpFilter });
        }
      }

      if (hasExtraFiles) {
        const staticDir = join(subPath, "static");
        mkdirSync(staticDir, { recursive: true });
        for (const [filename, content] of Object.entries(opts.extraFiles!)) {
          const filePath = join(staticDir, filename);
          mkdirSync(dirnameFn(filePath), { recursive: true });
          writeFileSync(filePath, content);
        }
      }

      // Compute content hash (same algorithm as buildImageCodeBuild)
      const hash = createHash("sha256");
      const hashFile = (p: string) => {
        if (HASH_EXCLUDED.some(re => re.test(p))) return;
        hash.update(p); 
        hash.update(readFileSync(join(subPath, p))); 
      };
      const hashDir = (dir: string) => {
        const entries = readdirSync(join(subPath, dir), { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          const p = join(dir, entry.name);
          if (entry.isDirectory()) hashDir(p);
          else hashFile(p);
        }
      };

      hash.update("Dockerfile");
      hash.update(readFileSync(join(subPath, "Dockerfile")));
      if (!opts.dockerfileContent) {
        hashFile("package.json");
        hashDir("dist");
        if (existsSync(join(subPath, "docker"))) hashDir("docker");
      }
      if (hasExtraFiles) hashDir("static");

      const contentHash = hash.digest("hex").slice(0, 16);
      const nameTag = opts.tag.replace(":", "-");
      const hashTag = `${nameTag}-${contentHash}`;
      const remoteTag = `${this.config.ecrRepository}:${hashTag}`;

      buildInfos.push({ idx: i, remoteTag, hashTag, nameTag, cached: false, subdir });
    }

    // Check cache for all builds in parallel
    const repoName = this.config.ecrRepository.split("/").pop()!;
    const cacheResults = await Promise.all(
      buildInfos.map(info => this.ecrImageExists(repoName, info.hashTag, onProgress)),
    );
    for (let i = 0; i < buildInfos.length; i++) {
      buildInfos[i].cached = cacheResults[i];
    }

    const uncached = buildInfos.filter(b => !b.cached);
    if (uncached.length === 0) {
      onProgress?.("All images unchanged — reusing cached builds");
      try { rmSync(combinedCtx, { recursive: true }); } catch {}
      return buildInfos.map(b => b.remoteTag);
    }

    onProgress?.(`Cache: ${buildInfos.length - uncached.length} hit, ${uncached.length} miss — building`);

    // Tar only uncached build subdirs
    const tarEntries = uncached.map(b => b.subdir);
    const tarPath = join(tmpdir(), `al-multi-${randomUUID().slice(0, 8)}.tar.gz`);

    try {
      execFileSync("tar", ["czf", tarPath, "-C", combinedCtx, ...tarEntries], {
        timeout: 120_000,
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
    } finally {
      try { rmSync(combinedCtx, { recursive: true }); } catch {}
    }

    onProgress?.("Uploading combined build context to S3");
    const bucket = await this.ensureBuildBucket();
    const s3Key = `${AWS_CONSTANTS.BUILD_S3_PREFIX}/multi-${Date.now()}.tar.gz`;
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: createReadStream(tarPath),
    }));
    try { rmSync(tarPath); } catch {}

    const projectName = AWS_CONSTANTS.CODEBUILD_PROJECT;
    await this.ensureCodeBuildProject(projectName, bucket);
    const registry = this.config.ecrRepository.split("/")[0];

    // Generate multi-image buildspec
    const buildCommands = uncached.flatMap((b) => {
      const cacheTag = `${this.config.ecrRepository}:${b.nameTag}-cache`;
      return [
        `echo "Building ${b.subdir}: ${b.remoteTag}"`,
        `docker pull ${cacheTag} || true`,
        `docker build --cache-from ${cacheTag} -t ${b.remoteTag} -f ${b.subdir}/Dockerfile ${b.subdir}`,
        `docker push ${b.remoteTag}`,
        `docker tag ${b.remoteTag} ${cacheTag}`,
        `docker push ${cacheTag}`,
      ];
    });

    const buildspec = [
      "version: 0.2",
      "phases:",
      "  pre_build:",
      "    commands:",
      "      - if ls *.tar.gz 1>/dev/null 2>&1; then tar xzf *.tar.gz && rm -f *.tar.gz; fi",
      `      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin ${registry}`,
      "  build:",
      "    commands:",
      ...buildCommands.map(cmd => `      - ${cmd}`),
    ].join("\n");

    const buildRes = await this.cbClient.send(new StartBuildCommand({
      projectName,
      sourceTypeOverride: "S3",
      sourceLocationOverride: `${bucket}/${s3Key}`,
      buildspecOverride: buildspec,
      environmentVariablesOverride: [
        { name: "ECR_REGISTRY", value: registry },
      ],
    }));

    const buildId = buildRes.build?.id;
    if (!buildId) throw new Error("CodeBuild did not return a build ID");

    onProgress?.(`Queued — building ${uncached.length} images in CodeBuild`);

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
          BUILD: `Building ${uncached.length} images`,
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
          throw new Error(`CodeBuild batch build failed (${build.buildStatus}). Logs: ${logs}`);
        }
        return buildInfos.map(b => b.remoteTag);
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

  /**
   * Scan log events in a time window using FilterLogEvents.
   * Returns events in ascending order. Uses time-bounded queries and limits
   * to improve performance by starting with a narrower time window.
   */
  async filterLogEvents(logGroupName: string, logStreamPrefix: string, limit: number, startTime?: number): Promise<string[]> {
    // Start with a narrow time window (last 1 hour) for better performance
    let queryStartTime = startTime ?? (Date.now() - 3600_000); // last 1 hour
    const fallbackStartTime = startTime ?? (Date.now() - 24 * 3600_000); // last 24 hours
    
    const allEvents: string[] = [];
    let nextToken: string | undefined;
    const MAX_PAGES = 10;
    let pageCount = 0;

    // Try narrow window first, expand if needed
    for (const currentStartTime of [queryStartTime, fallbackStartTime]) {
      if (allEvents.length >= limit) break;
      if (currentStartTime === fallbackStartTime && queryStartTime >= fallbackStartTime) break;

      nextToken = undefined;
      pageCount = 0;

      do {
        const res: any = await this.logsClient.send(new FilterLogEventsCommand({
          logGroupName,
          ...(logStreamPrefix ? { logStreamNamePrefix: logStreamPrefix } : {}),
          startTime: currentStartTime,
          ...(nextToken ? { nextToken } : {}),
        }));

        for (const e of res.events ?? []) {
          const msg = e.message?.trimEnd();
          if (msg) {
            allEvents.push(msg);
            // Early exit if we have enough events
            if (allEvents.length >= limit * 3) break;
          }
        }

        nextToken = res.nextToken;
        pageCount++;
      } while (nextToken && pageCount < MAX_PAGES && allEvents.length < limit * 3);

      // If we got enough results, no need to try the wider window
      if (allEvents.length >= limit) break;
    }

    return allEvents.slice(-limit);
  }

  /**
   * Single-page FilterLogEvents call that returns the nextToken for streaming.
   * Callers poll repeatedly with the returned nextToken to get new events
   * (Option 2 / tail -f behavior).
   */
  async filterLogEventsRaw(
    logGroupName: string,
    logStreamPrefix: string,
    nextToken?: string,
    startTime?: number,
  ): Promise<{ events: string[]; nextToken?: string }> {
    const res = await this.logsClient.send(new FilterLogEventsCommand({
      logGroupName,
      ...(logStreamPrefix ? { logStreamNamePrefix: logStreamPrefix } : {}),
      ...(nextToken ? { nextToken } : {}),
      ...(startTime && !nextToken ? { startTime } : {}),
    }));

    const events = (res.events ?? [])
      .map((e) => e.message?.trimEnd() ?? "")
      .filter(Boolean);

    return { events, nextToken: res.nextToken };
  }

  /**
   * Tail the most recent log events using FilterLogEvents.
   * Returns the last `limit` events in chronological order.
   */
  async tailLogEvents(logGroupName: string, logStreamPrefix: string, limit: number): Promise<string[]> {
    return this.filterLogEvents(logGroupName, logStreamPrefix, limit);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
