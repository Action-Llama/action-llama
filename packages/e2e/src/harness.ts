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
  sshHost?: string;
  sshPort?: number;
  /** Mapped host ports, keyed by container port (e.g. "8080/tcp" → 49152). */
  mappedPorts?: Record<string, number>;
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

  private async verifyNetworkExists(): Promise<void> {
    // Add network verification before creating containers
    const networks = await this.docker.listNetworks();
    const e2eNetwork = networks.find(n => n.Name === 'action-llama-e2e');
    if (!e2eNetwork) {
      throw new Error('E2E test network not found. Ensure global setup has run.');
    }
    
    // Verify network is properly configured
    const network = await this.docker.getNetwork(e2eNetwork.Id).inspect();
    console.log('E2E Network details:', {
      id: network.Id,
      name: network.Name,
      driver: network.Driver,
      ipam: network.IPAM
    });
  }

  async createLocalActionLlamaContainer(opts?: {
    /** Container ports to expose to the host (e.g. ["8080/tcp"]). */
    exposePorts?: string[];
  }): Promise<ContainerInfo> {
    // Verify network exists before proceeding
    await this.verifyNetworkExists();

    // Build the local Action Llama container
    await this.buildImage("action-llama-local", "docker/local");

    const containerName = `action-llama-e2e-local-${this.runId}`;

    // Build port bindings if requested
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, Record<string, never>> = {};
    for (const port of opts?.exposePorts ?? []) {
      portBindings[port] = [{ HostPort: "0" }]; // random host port
      exposedPorts[port] = {};
    }

    const container = await this.docker.createContainer({
      Image: "action-llama-local:latest",
      name: containerName,
      Env: [
        "NODE_ENV=test",
        "AL_TEST_MODE=1",
        "AL_MOCK_CREDENTIALS=1",
        `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || 'test-key'}`,
        `OPENAI_API_KEY=${process.env.OPENAI_API_KEY || 'test-key'}`,
      ],
      WorkingDir: "/app",
      Cmd: ["tail", "-f", "/dev/null"], // Keep container running
      ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
      HostConfig: {
        NetworkMode: "action-llama-e2e",
        PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
      },
    });

    await container.start();

    // Container is already on the network via NetworkMode - just wait for IP assignment
    let ipAddress: string | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const containerInfo = await container.inspect();
      ipAddress = containerInfo.NetworkSettings.Networks["action-llama-e2e"]?.IPAddress;
      if (ipAddress) break;
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Resolve mapped host ports
    const mappedPorts: Record<string, number> = {};
    if (opts?.exposePorts?.length) {
      const inspectInfo = await container.inspect();
      for (const port of opts.exposePorts) {
        const bindings = inspectInfo.NetworkSettings.Ports?.[port];
        if (bindings?.[0]?.HostPort) {
          mappedPorts[port] = parseInt(bindings[0].HostPort, 10);
        }
      }
    }

    const info: ContainerInfo = {
      id: container.id,
      name: containerName,
      ipAddress,
      mappedPorts: Object.keys(mappedPorts).length > 0 ? mappedPorts : undefined,
    };

    this.containers.push(info);
    return info;
  }

  async createVPSContainer(): Promise<ContainerInfo> {
    // Verify network exists before proceeding
    await this.verifyNetworkExists();
    
    // Build the VPS container with SSH and Docker
    await this.buildImage("action-llama-vps", "docker/vps");
    
    const containerName = `action-llama-e2e-vps-${this.runId}`;
    
    const container = await this.docker.createContainer({
      Image: "action-llama-vps:latest",
      name: containerName,
      Privileged: true, // Needed for Docker-in-Docker
      Env: [
        "SSH_ENABLE_ROOT=true",
        "SSH_ENABLE_PASSWORD_AUTH=false",
      ],
      HostConfig: {
        NetworkMode: "action-llama-e2e",
        PortBindings: {
          "22/tcp": [{ HostPort: "0" }], // Random host port
        },
      },
      ExposedPorts: {
        "22/tcp": {},
        "2375/tcp": {}, // Docker daemon
      },
    });

    await container.start();

    // Write authorized_keys directly inside the container with correct ownership
    // and permissions. Bind-mounting from the host can cause UID mismatches that
    // make sshd reject the file ("bad ownership or modes").
    const pubKeyEscaped = this.sshKeyPair.publicKey.replace(/'/g, "'\\''");
    const setupSSH = await container.exec({
      Cmd: [
        "bash", "-c",
        `mkdir -p /root/.ssh && chmod 700 /root/.ssh && printf '%s' '${pubKeyEscaped}' > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && chown -R root:root /root/.ssh`,
      ],
      AttachStdout: true,
      AttachStderr: true,
    });
    const sshSetupStream = await setupSSH.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve) => sshSetupStream.on("end", resolve));

    // Container is already on the network via NetworkMode - wait for IP assignment
    let ipAddress: string | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const containerInfo = await container.inspect();
      ipAddress = containerInfo.NetworkSettings.Networks["action-llama-e2e"]?.IPAddress;
      if (ipAddress) break;
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (!ipAddress) {
      const containerInfo = await container.inspect();
      console.error("Container network state:", JSON.stringify(containerInfo.NetworkSettings, null, 2));
      throw new Error(`Failed to get IP address for container ${containerName} after 10 attempts`);
    }

    // Get the mapped SSH port on the host
    const inspectInfo = await container.inspect();
    const portBindings = inspectInfo.NetworkSettings.Ports?.["22/tcp"];
    const mappedPort = portBindings?.[0]?.HostPort;
    if (!mappedPort) {
      throw new Error(`Failed to get mapped SSH port for container ${containerName}`);
    }

    const info: ContainerInfo = {
      id: container.id,
      name: containerName,
      ipAddress,
      sshHost: "127.0.0.1",
      sshPort: parseInt(mappedPort, 10),
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
    const host = containerInfo.sshHost || containerInfo.ipAddress;
    const port = containerInfo.sshPort || 22;
    if (!host) {
      throw new Error("Container SSH host not available");
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
        host,
        port,
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
    
    // Verify required build artifacts exist for local image
    if (imageName === "action-llama-local") {
      const requiredPaths = [
        'packages/action-llama/dist',
        'packages/action-llama/package.json',
        'packages/shared/dist',
        'packages/shared/package.json'
      ];
      
      for (const requiredPath of requiredPaths) {
        const absolutePath = path.join(repoRoot, requiredPath);
        try {
          await fs.access(absolutePath);
        } catch (error) {
          throw new Error(`Required build artifact not found: ${requiredPath}. Run 'npm run build' first.`);
        }
      }
    }
    
    console.log(`Building Docker image ${imageName}:latest from ${dockerfilePath}...`);
    
    const tarStream = tar.pack(repoRoot);
    const stream = await this.docker.buildImage(
      tarStream,
      { 
        t: `${imageName}:latest`,
        dockerfile: dockerfilePath  // Relative to repoRoot
      }
    );
    
    return new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, output) => {
        if (output) {
          output.forEach((event: any) => {
            if (event.stream) {
              console.log(`[${imageName}] ${event.stream.trim()}`);
            }
            if (event.error) {
              console.error(`[${imageName}] Docker build error:`, event.error);
            }
          });
        }
        if (err) {
          console.error(`[${imageName}] Docker build failed:`, err);
          reject(err);
        } else {
          console.log(`[${imageName}] Docker image built successfully`);
          resolve();
        }
      });
    });
  }

  private async waitForSSH(containerInfo: ContainerInfo, maxAttempts = 60): Promise<void> {
    const host = containerInfo.sshHost || containerInfo.ipAddress;
    if (!host) {
      throw new Error("Container SSH host not available for SSH connection");
    }

    let lastError: Error | null = null;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        // First check if SSH port is open with a simple connection test
        await this.testSSHConnection(containerInfo);
        
        // Then verify SSH actually works with a command
        await this.executeSSHCommand(containerInfo, "echo 'SSH Ready'");
        console.log(`SSH connection established after ${i + 1} attempts`);
        return;
      } catch (error: any) {
        lastError = error;
        
        if (i < maxAttempts - 1) {
          // Log progress for debugging
          if (i % 10 === 9) {
            console.log(`SSH connection attempt ${i + 1}/${maxAttempts} failed: ${error.message}`);
          }
          
          // Wait progressively longer for the first few attempts to allow service startup
          const delay = i < 10 ? 2000 : 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // On final attempt, always capture and include container logs
          console.error(`SSH connection failed after ${maxAttempts} attempts. Last error:`, lastError.message);
          
          try {
            const containerLogs = await this.getContainerLogs(containerInfo);
            console.error("VPS container logs:", containerLogs);
            
            // Try to get startup logs specifically
            const startupLogs = await this.getStartupLogs(containerInfo);
            if (startupLogs) {
              console.error("VPS startup logs:", startupLogs);
            }
            
            throw new Error(`SSH service failed to start within timeout after ${maxAttempts} attempts. Host: ${host}:${containerInfo.sshPort || 22}. Last error: ${lastError.message}. Container logs: ${containerLogs.slice(-1000)}`);
          } catch (logError) {
            throw new Error(`SSH service failed to start within timeout after ${maxAttempts} attempts. Host: ${host}:${containerInfo.sshPort || 22}. Last error: ${lastError.message}. Could not retrieve container logs: ${logError}`);
          }
        }
      }
    }
  }

  private async testSSHConnection(containerInfo: ContainerInfo): Promise<void> {
    const host = containerInfo.sshHost || containerInfo.ipAddress;
    const port = containerInfo.sshPort || 22;

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
        host,
        port,
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
        tail: 100
      });
      return stream.toString();
    } catch {
      return "Could not retrieve container logs";
    }
  }

  private async getStartupLogs(containerInfo: ContainerInfo): Promise<string | null> {
    try {
      // Try to get the startup log file we created in the Dockerfile
      const startupLogs = await this.executeSSHCommand(containerInfo, "cat /tmp/startup.log 2>/dev/null || echo 'No startup log found'");
      return startupLogs;
    } catch {
      // If SSH fails, try to get it directly from the container
      try {
        const container = this.docker.getContainer(containerInfo.id);
        const exec = await container.exec({
          Cmd: ["cat", "/tmp/startup.log"],
          AttachStdout: true,
          AttachStderr: true,
        });
        
        const stream = await exec.start({ hijack: true, stdin: false });
        
        return new Promise((resolve) => {
          let output = "";
          
          stream.on("data", (data: Buffer) => {
            const str = data.toString();
            if (data[0] === 1) {
              output += str.slice(8); // Remove Docker stream header
            }
          });
          
          stream.on("end", () => {
            resolve(output.trim() || null);
          });
          
          // Set a timeout for this operation
          setTimeout(() => {
            resolve(null);
          }, 5000);
        });
      } catch {
        return null;
      }
    }
  }

  getPrivateKeyPath(): string {
    return path.join(this.tempDir, "id_rsa");
  }

  getPublicKey(): string {
    return this.sshKeyPair.publicKey;
  }

  getPrivateKeyContent(): string {
    return this.sshKeyPair.privateKey;
  }
}