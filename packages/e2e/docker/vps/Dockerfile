FROM ubuntu:22.04

# Install SSH server and dependencies
RUN apt-get update && apt-get install -y \
    openssh-server \
    curl \
    wget \
    git \
    rsync \
    sudo \
    ca-certificates \
    openssl \
    netcat-openbsd \
    systemd \
    systemd-sysv \
    fail2ban \
    && rm -rf /var/lib/apt/lists/*

# Set up SSH
RUN mkdir /var/run/sshd
RUN echo 'root:password' | chpasswd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
RUN sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
RUN sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# SSH login fix. Otherwise user is kicked off after login
RUN sed 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' -i /etc/pam.d/sshd

# Create SSH directory for root
RUN mkdir -p /root/.ssh
RUN chmod 700 /root/.ssh

# Mock Docker CLI — Docker-in-Docker doesn't work on macOS Docker Desktop
# al push only checks `docker info --format '{{.ServerVersion}}'`
RUN printf '#!/bin/bash\nif [[ "$1" == "info" ]]; then\n  if [[ "$*" == *"--format"* ]]; then\n    echo "24.0.0"\n  else\n    echo "Server Version: 24.0.0"\n  fi\n  exit 0\nfi\nexit 0\n' > /usr/local/bin/docker && chmod +x /usr/local/bin/docker

# Mock systemctl — systemd doesn't run in Docker containers
# al push uses systemctl for daemon-reload, enable, restart, is-active
RUN printf '#!/bin/bash\ncase "$1" in\n  is-active) echo "active"; exit 0;;\n  status) echo "active (running)"; exit 0;;\n  *) exit 0;;\nesac\n' > /usr/local/bin/systemctl && chmod +x /usr/local/bin/systemctl

# Wrap curl to fake the health check endpoint that al push polls
# The real curl is at /usr/bin/curl; wrapper intercepts health check requests
RUN mv /usr/bin/curl /usr/bin/curl.real && \
    printf '#!/bin/bash\nfor arg in "$@"; do\n  if [[ "$arg" == *"/health"* ]]; then\n    echo "ok"\n    exit 0\n  fi\ndone\nexec /usr/bin/curl.real "$@"\n' > /usr/bin/curl && chmod +x /usr/bin/curl

# Install real nginx so `nginx -t` validates config syntax (catches quoting bugs).
# systemctl reload is still mocked, so nginx won't actually run as a service.
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/* && \
    mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

# Mock journalctl — used by al push for live log tailing during health check
RUN printf '#!/bin/bash\nexit 0\n' > /usr/local/bin/journalctl && chmod +x /usr/local/bin/journalctl

# Wrap npm so `npm install` is fast and doesn't need registry access
# The real npm is at the Node.js install path; our wrapper intercepts `install`
RUN mv /usr/bin/npm /usr/bin/npm.real 2>/dev/null; \
    printf '#!/bin/bash\nif [[ "$1" == "install" || "$1" == "i" || "$1" == "ci" ]]; then\n  echo "up to date, audited 1 package"\n  exit 0\nfi\nexec /usr/bin/npm.real "$@" 2>/dev/null || exit 0\n' > /usr/local/bin/npm && chmod +x /usr/local/bin/npm

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Note: systemctl is mocked, so no systemd service setup needed

# Create deployment directory
RUN mkdir -p /opt/action-llama

# Expose SSH port
EXPOSE 22

# Verify SSH daemon configuration during build
RUN /usr/sbin/sshd -t || (echo "SSH config test failed" && exit 1)

# Add health check to verify SSH is running
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s \
  CMD nc -z localhost 22 || exit 1

# Start script that runs SSH
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Ensure SSH host keys exist\n\
for type in rsa ecdsa ed25519; do\n\
    if [ ! -f /etc/ssh/ssh_host_${type}_key ]; then\n\
        ssh-keygen -t $type -f /etc/ssh/ssh_host_${type}_key -N "" || exit 1\n\
    fi\n\
done\n\
chmod 600 /etc/ssh/ssh_host_*_key\n\
chmod 644 /etc/ssh/ssh_host_*_key.pub\n\
\n\
mkdir -p /var/run/sshd /root/.ssh\n\
chmod 700 /root/.ssh\n\
\n\
if [ -f /root/.ssh/authorized_keys ]; then\n\
    chmod 600 /root/.ssh/authorized_keys\n\
fi\n\
\n\
exec /usr/sbin/sshd -D -e\n\
' > /start.sh && chmod +x /start.sh

CMD ["/start.sh"]