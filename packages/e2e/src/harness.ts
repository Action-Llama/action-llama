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
    
    // Wait for container to be fully started and connected to network
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get container IP address
    let containerInfo = await container.inspect();
    
    // Retry if IP not immediately available
    if (!containerInfo.NetworkSettings.Networks["action-llama-e2e"]?.IPAddress) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      containerInfo = await container.inspect();
    }
    
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
    
    // Wait for container to be fully started and connected to network
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get container IP address
    let containerInfo = await container.inspect();
    
    // Retry if IP not immediately available
    if (!containerInfo.NetworkSettings.Networks["action-llama-e2e"]?.IPAddress) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      containerInfo = await container.inspect();
    }
    
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
    if (!containerInfo.ipAddress) {
      throw new Error("Container IP address not available for SSH connection");
    }

    for (let i = 0; i < maxAttempts; i++) {
      try {
        // First check if SSH port is open with a simple connection test
        await this.testSSHConnection(containerInfo);
        
        // Then verify SSH actually works with a command
        await this.executeSSHCommand(containerInfo, "echo 'SSH Ready'");
        return;
      } catch (error: any) {
        if (i < maxAttempts - 1) {
          // Wait progressively longer for the first few attempts to allow service startup
          const delay = i < 10 ? 2000 : 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // On final attempt, include more diagnostic info
          try {
            const containerLogs = await this.getContainerLogs(containerInfo);
            throw new Error(`SSH service failed to start within timeout. Container logs: ${containerLogs.slice(-1000)}`);
          } catch {
            throw new Error(`SSH service failed to start within timeout after ${maxAttempts} attempts. IP: ${containerInfo.ipAddress}`);
          }
        }
      }
    }
  }

  private async testSSHConnection(containerInfo: ContainerInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error("SSH connection timeout"));
      }, 5000);
      
      conn.on("ready", () => {
        clearTimeout(timeout);
        conn.end();
        resolve();
      });
      
      conn.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      conn.connect({
        host: containerInfo.ipAddress,
        port: 22,
        username: "root",
        privateKey: this.sshKeyPair.privateKey,
        readyTimeout: 5000,
      });
    });
  }

  private async getContainerLogs(containerInfo: ContainerInfo): Promise<string> {
    try {
      const container = this.docker.getContainer(containerInfo.id);
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        tail: 50
      });
      return stream.toString();
    } catch {
      return "Could not retrieve container logs";
    }
  }

  getPrivateKeyPath(): string {
    return path.join(this.tempDir, "id_rsa");
  }

  getPublicKey(): string {
    return this.sshKeyPair.publicKey;
  }
}