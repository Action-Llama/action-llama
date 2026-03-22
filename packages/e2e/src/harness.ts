import Docker from "dockerode";
import { randomUUID } from "crypto";
import tar from "tar-fs";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Client as SSHClient, utils as ssh2Utils } from "ssh2";
import { assertDockerAvailable, isDockerAvailable } from "./docker-utils.js";

export interface ContainerInfo {
  id: string;
  name: string;
  ipAddress?: string;
}

export class E2ETestContext {
  private docker: Docker;
  private containers: ContainerInfo[] = [];
  private runId: string;
  private sshKeyPair: { publicKey: string; privateKey: string };
  private tempDir: string;

  constructor() {
    this.docker = new Docker();
    this.runId = randomUUID().substring(0, 8);
    this.sshKeyPair = this.generateSSHKeyPair();
    this.tempDir = `/tmp/e2e-${this.runId}`;
  }

  async setup() {
    // Check if Docker is available
    await assertDockerAvailable();

    // Create temp directory for test artifacts
    await fs.mkdir(this.tempDir, { recursive: true });
    
    // Write SSH keys to temp directory
    await fs.writeFile(
      path.join(this.tempDir, "id_rsa"),
      this.sshKeyPair.privateKey,
      { mode: 0o600 }
    );
    await fs.writeFile(
      path.join(this.tempDir, "id_rsa.pub"),
      this.sshKeyPair.publicKey
    );
  }

  async cleanup() {
    // Stop and remove all containers created during this test
    for (const containerInfo of this.containers) {
      try {
        const container = this.docker.getContainer(containerInfo.id);
        await container.stop({ t: 10 });
        await container.remove({ force: true });
      } catch (error: any) {
        console.warn(`Failed to cleanup container ${containerInfo.name}:`, error.message);
      }
    }
    
    // Clean up temp directory
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (error: any) {
      console.warn(`Failed to cleanup temp directory:`, error.message);
    }
    
    this.containers = [];
  }

  private generateSSHKeyPair() {
    const { public: publicKey, private: privateKey } = ssh2Utils.generateKeyPairSync("rsa", {
      bits: 2048,
      comment: "e2e-test@action-llama"
    });

    return {
      publicKey,
      privateKey,
    };
  }

  async createLocalActionLlamaContainer(): Promise<ContainerInfo> {
    // Build the local Action Llama container
    await this.buildImage("action-llama-local", "docker/local");
    
    const containerName = `action-llama-e2e-local-${this.runId}`;
    
    const container = await this.docker.createContainer({
      Image: "action-llama-local:latest",
      name: containerName,
      NetworkMode: "action-llama-e2e",
      Env: [
        "NODE_ENV=test",
        "AL_TEST_MODE=1",
        "AL_MOCK_CREDENTIALS=1",
      ],
      WorkingDir: "/app",
      Cmd: ["tail", "-f", "/dev/null"], // Keep container running
    });

    await container.start();
    
    // Get container IP address
    const containerInfo = await container.inspect();
    const ipAddress = containerInfo.NetworkSettings.Networks["action-llama-e2e"]?.IPAddress;
    
    const info: ContainerInfo = {
      id: container.id,
      name: containerName,
      ipAddress,
    };
    
    this.containers.push(info);
    return info;
  }

  async createVPSContainer(): Promise<ContainerInfo> {
    // Build the VPS container with SSH and Docker
    await this.buildImage("action-llama-vps", "docker/vps");
    
    const containerName = `action-llama-e2e-vps-${this.runId}`;
    
    // Create authorized_keys file
    const authorizedKeysPath = path.join(this.tempDir, "authorized_keys");
    await fs.writeFile(authorizedKeysPath, this.sshKeyPair.publicKey);
    
    const container = await this.docker.createContainer({
      Image: "action-llama-vps:latest",
      name: containerName,
      NetworkMode: "action-llama-e2e",
      Privileged: true, // Needed for Docker-in-Docker
      Env: [
        "SSH_ENABLE_ROOT=true",
        "SSH_ENABLE_PASSWORD_AUTH=false",
      ],
      HostConfig: {
        Binds: [
          `${authorizedKeysPath}:/root/.ssh/authorized_keys:ro`,
        ],
      },
      ExposedPorts: {
        "22/tcp": {},
        "2375/tcp": {}, // Docker daemon
      },
    });

    await container.start();
    
    // Get container IP address
    const containerInfo = await container.inspect();
    const ipAddress = containerInfo.NetworkSettings.Networks["action-llama-e2e"]?.IPAddress;
    
    const info: ContainerInfo = {
      id: container.id,
      name: containerName,
      ipAddress,
    };
    
    this.containers.push(info);
    
    // Wait for SSH service to be ready
    await this.waitForSSH(info);
    
    return info;
  }

  async executeInContainer(containerInfo: ContainerInfo, cmd: string[]): Promise<string> {
    const container = this.docker.getContainer(containerInfo.id);
    
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    
    const stream = await exec.start({ hijack: true, stdin: false });
    
    return new Promise((resolve, reject) => {
      let output = "";
      let error = "";
      
      stream.on("data", (data: Buffer) => {
        const str = data.toString();
        if (data[0] === 1) {
          output += str.slice(8); // Remove Docker stream header
        } else if (data[0] === 2) {
          error += str.slice(8);
        }
      });
      
      stream.on("end", () => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(output.trim());
        }
      });
    });
  }

  async executeSSHCommand(containerInfo: ContainerInfo, command: string): Promise<string> {
    if (!containerInfo.ipAddress) {
      throw new Error("Container IP address not available");
    }
    
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      
      conn.on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          
          let output = "";
          let error = "";
          
          stream.on("close", (code: number) => {
            conn.end();
            if (code !== 0) {
              reject(new Error(`Command failed with exit code ${code}: ${error}`));
            } else {
              resolve(output.trim());
            }
          });
          
          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });
          
          stream.stderr.on("data", (data: Buffer) => {
            error += data.toString();
          });
        });
      });
      
      conn.on("error", reject);
      
      conn.connect({
        host: containerInfo.ipAddress,
        port: 22,
        username: "root",
        privateKey: this.sshKeyPair.privateKey,
      });
    });
  }

  private async buildImage(imageName: string, contextPath: string) {
    // Use ES module equivalent of __dirname to get the absolute path to the harness.ts file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Navigate from packages/e2e/src to repo root (3 levels up)
    const repoRoot = path.resolve(__dirname, "../../..");
    
    // Use repo root as build context, but specify dockerfile location
    const normalizedContextPath = contextPath.replace(/^\.\//, "");
    const dockerfilePath = path.join("packages/e2e", normalizedContextPath, "Dockerfile");
    
    // Verify the dockerfile exists before building
    const absoluteDockerfilePath = path.join(repoRoot, dockerfilePath);
    try {
      await fs.access(absoluteDockerfilePath);
    } catch (error) {
      throw new Error(`Dockerfile not found: ${absoluteDockerfilePath}`);
    }
    
    const tarStream = tar.pack(repoRoot);
    const stream = await this.docker.buildImage(
      tarStream,
      { 
        t: `${imageName}:latest`,
        dockerfile: dockerfilePath  // Relative to repoRoot
      }
    );
    
    return new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async waitForSSH(containerInfo: ContainerInfo, maxAttempts = 60): Promise<void> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.executeSSHCommand(containerInfo, "echo 'SSH Ready'");
        return;
      } catch (error) {
        lastError = error as Error;
        
        // Log progress and diagnostics every 10 attempts
        if (i > 0 && i % 10 === 0) {
          console.log(`Waiting for SSH on ${containerInfo.name} (attempt ${i + 1}/${maxAttempts}): ${lastError.message}`);
          
          // Check SSH service status in container for diagnostics
          try {
            const sshStatus = await this.executeInContainer(containerInfo, ["ps", "aux"]);
            console.log(`Container processes:\n${sshStatus}`);
          } catch (diagError) {
            console.log(`Failed to get container diagnostics: ${(diagError as Error).message}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Enhanced error message with final diagnostics
    const errorMessage = `SSH service failed to start within ${maxAttempts} seconds on container ${containerInfo.name}`;
    const diagnostics = lastError ? `. Last error: ${lastError.message}` : '';
    
    // Try to get final container state for debugging
    try {
      const finalState = await this.executeInContainer(containerInfo, ["ps", "aux"]);
      throw new Error(errorMessage + diagnostics + `\n\nFinal container processes:\n${finalState}`);
    } catch (finalDiagError) {
      throw new Error(errorMessage + diagnostics + `\n\nFailed to get final diagnostics: ${(finalDiagError as Error).message}`);
    }
  }

  getPrivateKeyPath(): string {
    return path.join(this.tempDir, "id_rsa");
  }

  getPublicKey(): string {
    return this.sshKeyPair.publicKey;
  }

  /**
   * Manually trigger an agent run via the gateway control API.
   * 
   * This method requires that the Action Llama scheduler is running with a gateway.
   * It will attempt to trigger the agent via HTTP request to the control endpoint.
   * 
   * @param containerInfo - The container where Action Llama is running
   * @param agentName - The name of the agent to trigger
   * @param gatewayPort - The port where the gateway is running (default: 3000)
   * @throws {Error} If the gateway is not available or the trigger request fails
   */
  async triggerAgent(containerInfo: ContainerInfo, agentName: string, gatewayPort = 3000): Promise<void> {
    try {
      // Try to trigger the agent via the control API
      // Note: E2E tests often run without authentication for simplicity
      const result = await this.executeInContainer(containerInfo, [
        "curl", "-f", "-X", "POST", 
        `http://localhost:${gatewayPort}/control/trigger/${agentName}`,
        "-H", "Content-Type: application/json"
      ]);
      
      // If curl succeeded, the agent was triggered
      console.log(`Successfully triggered agent ${agentName}: ${result}`);
    } catch (error) {
      // If the control API fails, try to get more information
      const errorMessage = (error as Error).message;
      
      // Check if gateway is running
      try {
        await this.executeInContainer(containerInfo, [
          "curl", "-f", `http://localhost:${gatewayPort}/health`
        ]);
        // Gateway is running but trigger failed
        throw new Error(`Failed to trigger agent ${agentName}: ${errorMessage}. Gateway is running but control API request failed.`);
      } catch (healthError) {
        // Gateway is not running or not accessible
        throw new Error(`Failed to trigger agent ${agentName}: Gateway not available on port ${gatewayPort}. Make sure the Action Llama scheduler is started with --gateway-port ${gatewayPort}.`);
      }
    }
  }
}