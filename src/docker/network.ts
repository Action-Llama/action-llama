import { execFileSync } from "child_process";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";

const NETWORK_NAME = AWS_CONSTANTS.NETWORK_NAME;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export function ensureNetwork(): void {
  try {
    docker("network", "inspect", NETWORK_NAME);
  } catch {
    docker("network", "create", NETWORK_NAME);
  }
}

export function removeNetwork(): void {
  try {
    docker("network", "rm", NETWORK_NAME);
  } catch {
    // Network may not exist or have active containers
  }
}

export { NETWORK_NAME };
