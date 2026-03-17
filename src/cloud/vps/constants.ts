/** VPS provider constants. */

export const VPS_CONSTANTS = {
  /** Default SSH user for VPS connections */
  DEFAULT_SSH_USER: "root",

  /** Default SSH port */
  DEFAULT_SSH_PORT: 22,

  /** Default SSH key path */
  DEFAULT_SSH_KEY_PATH: "~/.ssh/id_rsa",

  /** Preferred OS for Vultr provisioning (Ubuntu 24.04 LTS) */
  PREFERRED_OS_ID: 2284, // Ubuntu 24.04 LTS x64

  /** Minimum VPS plan specs */
  MIN_VCPUS: 2,
  MIN_RAM_MB: 2048,

  /** Scheduler container name on VPS */
  SCHEDULER_CONTAINER: "al-scheduler",

  /** Credentials directory on VPS */
  REMOTE_CREDENTIALS_DIR: "~/.action-llama/credentials",

  /** Cloud-init script to install Docker on a fresh Ubuntu VPS */
  CLOUD_INIT_SCRIPT: `#!/bin/bash
set -euo pipefail

# Install Docker via official script
curl -fsSL https://get.docker.com | sh

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Signal that cloud-init is done
touch /var/lib/cloud/instance/boot-finished-docker
`,
} as const;
