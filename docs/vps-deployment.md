# VPS Deployment

Deploy Action Llama on any VPS (DigitalOcean, Vultr, Hetzner, etc.) for cost-effective remote hosting. This approach uses local-mode features (Docker, filesystem credentials, SQLite) with public gateway access.

## Quick Start

On your VPS:

```bash
# Install Action Llama
npm install -g @action-llama/action-llama

# Set up your project (or clone from git)
al new my-project
cd my-project

# Configure credentials and check setup
al doctor

# Start with public gateway binding
al start -g -w --expose --headless
```

## Key Features

The `--expose` flag enables VPS deployment by:

- **Binding gateway to `0.0.0.0`** — makes webhooks accessible from external services
- **Preserving local-mode features** — web UI, control routes, filesystem credentials, SQLite state
- **No cloud infrastructure required** — works on any Linux VPS

## TLS Setup with Caddy

For production, put a reverse proxy in front with TLS termination:

### 1. Install Caddy

```bash
# Ubuntu/Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 2. Configure Caddy

Edit `/etc/caddy/Caddyfile`:

```
your-domain.com {
    reverse_proxy localhost:8080
}
```

### 3. Start Caddy

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

## Process Management with systemd

Create `/etc/systemd/system/action-llama.service`:

```ini
[Unit]
Description=Action Llama Scheduler
After=network.target

[Service]
Type=simple
User=action-llama
WorkingDirectory=/home/action-llama/my-project
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/al start -g -w --expose --headless
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
sudo systemctl enable action-llama
sudo systemctl start action-llama
```

## Alternative: nohup

For simpler setups, use `nohup`:

```bash
nohup al start -g -w --expose --headless > action-llama.log 2>&1 &
```

## Firewall Configuration

Ensure your VPS firewall allows:

- Port 22 (SSH)
- Port 80 (HTTP, for Caddy)
- Port 443 (HTTPS, for Caddy)
- Port 8080 only if not using a reverse proxy

Example with `ufw`:

```bash
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
```

## Security Considerations

- **Use TLS in production** — Don't expose port 8080 directly without HTTPS
- **Gateway API key** — Action Llama generates an API key for dashboard access (run `al doctor` to view it)
- **Credentials isolation** — Each agent runs in a Docker container with only its required credentials
- **User separation** — Run Action Llama as a non-root user

## Monitoring

Check service status:

```bash
# systemd
sudo systemctl status action-llama

# Logs
al logs scheduler
journalctl -u action-llama -f
```

## Cost Comparison

| Provider | vCPU | RAM | Storage | Price/month |
|----------|------|-----|---------|-------------|
| DigitalOcean | 1 | 1GB | 25GB SSD | $6 |
| Vultr | 1 | 1GB | 25GB SSD | $6 |
| Hetzner | 1 | 2GB | 20GB SSD | €4.15 |
| Linode | 1 | 1GB | 25GB SSD | $5 |

Compare to managed cloud solutions that may cost $50+ per month for similar agent workloads.

## Troubleshooting

### Gateway not accessible externally

- Check firewall settings
- Verify `--expose` flag is used

### Docker issues

```bash
# Check Docker daemon
sudo systemctl status docker

# Test Docker access
docker ps
```

### Webhook delivery failures

- Check reverse proxy configuration
- Verify TLS certificate is valid
- Test webhook URL accessibility from external services

### Out of disk space

- Clean up old Docker images: `docker system prune -a`
- Rotate logs: configure systemd journal limits
- Monitor disk usage: `df -h`