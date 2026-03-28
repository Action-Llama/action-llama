import Docker from "dockerode";
import { execSync } from "child_process";
import { assertDockerAvailable, isDockerAvailable } from "./docker-utils.js";

export async function setup() {
  // Ensure Playwright Chromium browser is installed before running browser tests
  execSync("npx playwright install chromium", { stdio: "inherit" });

  // Check if Docker is available before proceeding
  await assertDockerAvailable();

  const docker = new Docker();
  
  // Create dedicated network for e2e tests
  try {
    await docker.createNetwork({
      Name: "action-llama-e2e",
      Driver: "bridge",
      IPAM: {
        Config: [{
          Subnet: "172.20.0.0/16",
          Gateway: "172.20.0.1",
          IPRange: "172.20.1.0/24",
        }],
      },
    });
  } catch (error: any) {
    // Network might already exist
    if (!error.message?.includes("already exists")) {
      throw error;
    }
  }
}

export async function teardown() {
  // Check if Docker is available before attempting cleanup
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    // Skip cleanup if Docker isn't available
    return;
  }

  const docker = new Docker();
  
  try {
    // Clean up any remaining containers
    const containers = await docker.listContainers({ all: true });
    for (const containerInfo of containers) {
      if (containerInfo.Names.some(name => name.includes("action-llama-e2e"))) {
        const container = docker.getContainer(containerInfo.Id);
        try {
          await container.stop();
          await container.remove();
        } catch {
          // Container might already be stopped/removed
        }
      }
    }
    
    // Remove network
    const network = docker.getNetwork("action-llama-e2e");
    await network.remove();
  } catch (error: any) {
    // Network might not exist or be in use
    console.warn("Failed to clean up e2e network:", error.message);
  }
}