---
"@action-llama/action-llama": patch
---

Added optional Cloudflare HTTPS support to `al env prov`. When provisioning a new Vultr VPS,
you can now opt in to Cloudflare HTTPS: the wizard collects your Cloudflare API token and
hostname, then after the VPS is up it creates a proxied DNS record, generates an Origin CA
certificate, installs nginx as a TLS-terminating reverse proxy, and sets the gateway URL to
`https://<hostname>`. Deprovisioning with `al env deprov` automatically cleans up the DNS record.
The existing plain HTTP flow is unchanged when you decline HTTPS.
