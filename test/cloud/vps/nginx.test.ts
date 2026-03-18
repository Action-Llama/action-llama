import { describe, it, expect } from "vitest";
import { generateNginxConfig } from "../../../src/cloud/vps/nginx.js";

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
});
