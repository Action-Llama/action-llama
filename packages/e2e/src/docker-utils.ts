import Docker from "dockerode";

/**
 * Check if Docker daemon is available by attempting to ping it.
 * This provides consistent Docker availability detection across all e2e components.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const docker = new Docker();
    await docker.ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Assert that Docker is available, throwing a consistent error message if not.
 * Use this in components that require Docker to be available.
 */
export async function assertDockerAvailable(): Promise<void> {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error("Docker is not available. E2E tests require Docker to run. Please ensure Docker is installed and running.");
  }
}