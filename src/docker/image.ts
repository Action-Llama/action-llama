import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..");

const DEFAULT_IMAGE = "al-agent:latest";

function docker(args: string[], opts?: { quiet?: boolean }): string {
  return execFileSync("docker", args, {
    encoding: "utf-8",
    stdio: opts?.quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
    timeout: 300000, // 5 min for builds
    cwd: PROJECT_ROOT,
  }).trim();
}

export function imageExists(image: string = DEFAULT_IMAGE): boolean {
  try {
    docker(["image", "inspect", image], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export function buildImage(image: string = DEFAULT_IMAGE): void {
  docker([
    "build",
    "-t", image,
    "-f", "docker/Dockerfile",
    ".",
  ]);
}

export function ensureImage(image: string = DEFAULT_IMAGE): void {
  if (!imageExists(image)) {
    buildImage(image);
  }
}
