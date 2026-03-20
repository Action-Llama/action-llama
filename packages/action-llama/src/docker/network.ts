import { execFileSync } from "child_process";
import { CONSTANTS } from "../shared/constants.js";

const NETWORK_NAME = CONSTANTS.NETWORK_NAME;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

export function ensureNetwork(): void {
  try {
    docker("network", "inspect", NETWORK_NAME);
  } catch {
    try {
      docker("network", "create", NETWORK_NAME);
    } catch (err: any) {
      // Another process may have created the network between inspect and create
      const msg = err?.stderr?.toString?.() ?? err?.message ?? "";
      if (msg.includes("already exists")) {
        return;
      }
      throw err;
    }
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
