import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateNginxConfig, installNginx, configureNginx } from "../../../src/cloud/vps/nginx.js";

vi.mock("../../../src/cloud/vps/ssh.js", () => ({
  sshExec: vi.fn(),
  scpBuffer: vi.fn(),
}));

import * as sshModule from "../../../src/cloud/vps/ssh.js";
const mockedSshExec = vi.mocked(sshModule.sshExec);
const mockedScpBuffer = vi.mocked(sshModule.scpBuffer);

const mockSshConfig = { host: "1.2.3.4", username: "root", privateKey: "key" };

describe("installNginx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs apt-get install nginx command", async () => {
    mockedSshExec.mockResolvedValue({ exitCode: 0, stdout: "nginx installed", stderr: "" });

    await installNginx(mockSshConfig);

    expect(mockedSshExec).toHaveBeenCalledOnce();
    const [, cmd] = mockedSshExec.mock.calls[0];
    expect(cmd).toContain("apt-get install -y nginx");
  });

  it("throws when nginx installation fails", async () => {
    mockedSshExec.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "E: Unable to fetch packages" });

    await expect(installNginx(mockSshConfig)).rejects.toThrow(
      "Failed to install nginx: E: Unable to fetch packages"
    );
  });
});

describe("configureNginx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates cert directory on the server", async () => {
    mockedSshExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockedScpBuffer.mockResolvedValue(undefined);

    await configureNginx(mockSshConfig, "example.com", "cert-content", "key-content", 3000);

    const mkdirCall = mockedSshExec.mock.calls[0];
    expect(mkdirCall[1]).toContain("mkdir -p");
  });

  it("uploads certificate and key via scp", async () => {
    mockedSshExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockedScpBuffer.mockResolvedValue(undefined);

    await configureNginx(mockSshConfig, "example.com", "my-cert", "my-key", 3000);

    const scpCalls = mockedScpBuffer.mock.calls;
    const uploadedContents = scpCalls.map(([, content]) => content);
    expect(uploadedContents).toContain("my-cert");
    expect(uploadedContents).toContain("my-key");
  });

  it("uploads an nginx config with the correct hostname", async () => {
    mockedSshExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockedScpBuffer.mockResolvedValue(undefined);

    await configureNginx(mockSshConfig, "myhost.com", "cert", "key", 4000);

    const scpCalls = mockedScpBuffer.mock.calls;
    const nginxConfig = scpCalls.find(([, content]) => (content as string).includes("server_name"));
    expect(nginxConfig).toBeDefined();
    expect(nginxConfig![1]).toContain("server_name myhost.com");
    expect(nginxConfig![1]).toContain("proxy_pass http://127.0.0.1:4000");
  });

  it("runs nginx enable and restart commands", async () => {
    mockedSshExec.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockedScpBuffer.mockResolvedValue(undefined);

    await configureNginx(mockSshConfig, "example.com", "cert", "key", 3000);

    const setupCall = mockedSshExec.mock.calls[mockedSshExec.mock.calls.length - 1];
    expect(setupCall[1]).toContain("nginx -t");
    expect(setupCall[1]).toContain("systemctl restart nginx");
  });
});

describe("generateNginxConfig", () => {
  it("generates config with correct hostname and port", () => {
    const config = generateNginxConfig("agents.example.com", 3000);

    expect(config).toContain("server_name agents.example.com");
    expect(config).toContain("proxy_pass http://127.0.0.1:3000");
  });

  it("includes HTTP-to-HTTPS redirect on port 80", () => {
    const config = generateNginxConfig("agents.example.com", 3000);

    expect(config).toContain("listen 80;");
    expect(config).toContain("return 301 https://");
  });

  it("includes SSL configuration on port 443", () => {
    const config = generateNginxConfig("agents.example.com", 3000);

    expect(config).toContain("listen 443 ssl;");
    expect(config).toContain("ssl_certificate     /etc/ssl/cloudflare/origin.pem");
    expect(config).toContain("ssl_certificate_key /etc/ssl/cloudflare/origin-key.pem");
  });

  it("includes WebSocket upgrade headers", () => {
    const config = generateNginxConfig("agents.example.com", 3000);

    expect(config).toContain("Upgrade $http_upgrade");
    expect(config).toContain('Connection "upgrade"');
  });

  it("includes TLS protocol settings", () => {
    const config = generateNginxConfig("agents.example.com", 3000);

    expect(config).toContain("ssl_protocols TLSv1.2 TLSv1.3");
    expect(config).toContain("ssl_prefer_server_ciphers on");
  });

  it("uses custom port in proxy_pass", () => {
    const config = generateNginxConfig("agents.example.com", 8080);

    expect(config).toContain("proxy_pass http://127.0.0.1:8080");
  });

  it("includes rate limiting configuration", () => {
    const config = generateNginxConfig("agents.example.com", 3000);

    expect(config).toContain("limit_req_zone");
    expect(config).toContain("zone=al_rate_limit:10m rate=5r/s");
    expect(config).toContain("limit_req zone=al_rate_limit burst=10 nodelay");
    expect(config).toContain("limit_req_status 429");
  });

  describe("with frontendPath", () => {
    it("serves static assets with alias", () => {
      const config = generateNginxConfig("agents.example.com", 3000, "/opt/al/frontend");

      expect(config).toContain("location /assets/");
      expect(config).toContain("alias /opt/al/frontend/assets/");
      expect(config).toContain("Cache-Control");
    });

    it("serves SPA routes with try_files fallback", () => {
      const config = generateNginxConfig("agents.example.com", 3000, "/opt/al/frontend");

      expect(config).toContain("location /login");
      expect(config).toContain("location /dashboard");
      expect(config).toContain("root /opt/al/frontend");
      expect(config).toContain("try_files /index.html =404");
    });

    it("proxies /dashboard/api/ to the gateway before the SPA catch-all", () => {
      const config = generateNginxConfig("agents.example.com", 3000, "/opt/al/frontend");

      expect(config).toContain("location /dashboard/api/");
      expect(config).toContain("proxy_pass http://127.0.0.1:3000");

      // /dashboard/api/ must appear before /dashboard to take priority
      const dashApiIndex = config.indexOf("location /dashboard/api/");
      const dashIndex = config.indexOf("location /dashboard {");
      expect(dashApiIndex).toBeLessThan(dashIndex);
    });

    it("SSE status-stream has buffering disabled for real-time events", () => {
      const config = generateNginxConfig("agents.example.com", 3000, "/opt/al/frontend");

      expect(config).toContain("location /dashboard/api/status-stream");
      expect(config).toContain("proxy_buffering off");
      expect(config).toContain("proxy_cache off");
      expect(config).toContain("proxy_read_timeout 86400s");

      // SSE location must appear before the general /dashboard/api/ block
      const sseIndex = config.indexOf("location /dashboard/api/status-stream");
      const dashApiIndex = config.indexOf("location /dashboard/api/ {");
      expect(sseIndex).toBeLessThan(dashApiIndex);
    });

    it("still proxies API routes to the gateway", () => {
      const config = generateNginxConfig("agents.example.com", 3000, "/opt/al/frontend");

      // The catch-all location / block should still proxy
      expect(config).toContain("location / {");
      expect(config).toContain("proxy_pass http://127.0.0.1:3000");
    });
  });
});
