import Docker from "dockerode";
import { randomUUID } from "crypto";
import { generateKeyPairSync } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Client as SSHClient } from "ssh2";

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
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    // Convert to SSH format
    const sshPublicKey = `ssh-rsa ${Buffer.from(publicKey).toString("base64")} e2e-test@action-llama`;
    
    return {
      publicKey: sshPublicKey,
      privateKey,
    };
  }

  async createLocalActionLlamaContainer(): Promise<ContainerInfo> {
    // Build the local Action Llama container
    await this.buildImage("action-llama-local", "./packages/e2e/docker/local");
    
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
    await this.buildImage("action-llama-vps", "./packages/e2e/docker/vps");
    
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
    const stream = await this.docker.buildImage(
      { context: contextPath, src: ["Dockerfile"] },
      { t: `${imageName}:latest` }
    );
    
    return new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async waitForSSH(containerInfo: ContainerInfo, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.executeSSHCommand(containerInfo, "echo 'SSH Ready'");
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error("SSH service failed to start within timeout");
  }

  getPrivateKeyPath(): string {
    return path.join(this.tempDir, "id_rsa");
  }

  getPublicKey(): string {
    return this.sshKeyPair.publicKey;
  }
}