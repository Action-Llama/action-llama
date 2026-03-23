/**
 * nginx configuration and SSH installation for TLS-terminating reverse proxy.
 */

import { VPS_CONSTANTS } from "./constants.js";
import { sshExec, scpBuffer, type SshConfig } from "./ssh.js";

/**
 * Generate an nginx site config for TLS termination with Cloudflare Origin CA.
 *
 * When `frontendPath` is provided, nginx serves the React SPA's static assets
 * directly for efficiency. API routes are proxied to the gateway.
 */
export function generateNginxConfig(hostname: string, gatewayPort: number, frontendPath?: string): string {
  const proxyBlock = `        proxy_pass http://127.0.0.1:${gatewayPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;`;

  // When the frontend is available, serve static assets directly and only proxy API routes.
  // Otherwise, proxy everything to the gateway (legacy server-rendered mode).
  const locationBlocks = frontendPath
    ? `
    # Frontend static assets (Vite-built, immutable hashes)
    location /assets/ {
        alias ${frontendPath}/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback: serve index.html for dashboard and login routes
    location /login {
        root ${frontendPath};
        try_files /index.html =404;
    }

    location /dashboard {
        root ${frontendPath};
        try_files /index.html =404;
    }

    # API, control, and data routes — proxy to gateway
    location / {
${proxyBlock}
    }`
    : `
    location / {
${proxyBlock}
    }`;

  return `# Action Llama — Cloudflare Origin CA TLS termination

# Rate limiting: 5 req/sec per IP with burst of 10
limit_req_zone $binary_remote_addr zone=al_rate_limit:10m rate=5r/s;
server {
    listen 80;
    listen [::]:80;
    server_name ${hostname};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${hostname};

    ssl_certificate     ${VPS_CONSTANTS.NGINX_CERT_PATH};
    ssl_certificate_key ${VPS_CONSTANTS.NGINX_KEY_PATH};

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Apply rate limit to all requests
    limit_req zone=al_rate_limit burst=10 nodelay;
    limit_req_status 429;
${locationBlocks}
}
`;
}

/**
 * Install nginx on the remote server.
 */
export async function installNginx(sshConfig: SshConfig): Promise<void> {
  const result = await sshExec(sshConfig, "apt-get update && apt-get install -y nginx", 120_000);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to install nginx: ${result.stderr}`);
  }
}

/**
 * Configure nginx with Origin CA certificate and reverse proxy.
 */
export async function configureNginx(
  sshConfig: SshConfig,
  hostname: string,
  cert: string,
  key: string,
  gatewayPort: number,
): Promise<void> {
  // Write certificate and key
  await sshExec(sshConfig, `mkdir -p ${VPS_CONSTANTS.NGINX_CERT_DIR}`);
  await scpBuffer(sshConfig, cert, VPS_CONSTANTS.NGINX_CERT_PATH);
  await scpBuffer(sshConfig, key, VPS_CONSTANTS.NGINX_KEY_PATH);

  // Write site config
  const config = generateNginxConfig(hostname, gatewayPort);
  await scpBuffer(sshConfig, config, VPS_CONSTANTS.NGINX_SITE_CONFIG);

  // Enable site, remove default, test, and restart
  await sshExec(
    sshConfig,
    [
      `ln -sf ${VPS_CONSTANTS.NGINX_SITE_CONFIG} /etc/nginx/sites-enabled/action-llama`,
      "rm -f /etc/nginx/sites-enabled/default",
      "nginx -t",
      "systemctl restart nginx",
    ].join(" && "),
  );
}
