FROM ubuntu:22.04

# Install SSH server, Docker, and other dependencies
RUN apt-get update && apt-get install -y \
    openssh-server \
    curl \
    wget \
    git \
    systemd \
    systemd-sysv \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    netcat-openbsd \
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

# Install Docker
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
RUN echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
RUN apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Enable systemd (needed for proper service management)
RUN systemctl enable ssh
RUN systemctl enable docker

# Create deployment directory
RUN mkdir -p /opt/action-llama

# Expose SSH port
EXPOSE 22

# Verify SSH daemon configuration during build
RUN /usr/sbin/sshd -t || (echo "SSH config test failed" && exit 1)

# Add health check to verify SSH is running
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s \
  CMD nc -z localhost 22 || exit 1

# Start script that runs SSH and Docker daemon
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Log startup process for debugging\n\
exec > >(tee -a /tmp/startup.log) 2>&1\n\
\n\
echo "Starting VPS container services at $(date)"\n\
echo "Container hostname: $(hostname)"\n\
echo "Container IP: $(hostname -i 2>/dev/null || echo unknown)"\n\
\n\
# Ensure SSH host keys exist\n\
echo "Checking SSH host keys..."\n\
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then\n\
    echo "Generating RSA host key..."\n\
    ssh-keygen -t rsa -f /etc/ssh/ssh_host_rsa_key -N "" || exit 1\n\
fi\n\
if [ ! -f /etc/ssh/ssh_host_ecdsa_key ]; then\n\
    echo "Generating ECDSA host key..."\n\
    ssh-keygen -t ecdsa -f /etc/ssh/ssh_host_ecdsa_key -N "" || exit 1\n\
fi\n\
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then\n\
    echo "Generating ED25519 host key..."\n\
    ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N "" || exit 1\n\
fi\n\
\n\
# Set proper permissions\n\
echo "Setting SSH key permissions..."\n\
chmod 600 /etc/ssh/ssh_host_*_key\n\
chmod 644 /etc/ssh/ssh_host_*_key.pub\n\
\n\
# Ensure SSH directory structure\n\
echo "Setting up SSH directory structure..."\n\
mkdir -p /var/run/sshd\n\
mkdir -p /root/.ssh\n\
chmod 700 /root/.ssh\n\
\n\
# Check if authorized_keys is properly mounted\n\
if [ -f /root/.ssh/authorized_keys ]; then\n\
    echo "Found authorized_keys file ($(wc -l < /root/.ssh/authorized_keys) lines)"\n\
    chmod 600 /root/.ssh/authorized_keys\n\
else\n\
    echo "WARNING: No authorized_keys file found"\n\
fi\n\
\n\
# Start Docker daemon in background\n\
echo "Starting Docker daemon at $(date)..."\n\
dockerd > /tmp/dockerd.log 2>&1 &\n\
DOCKER_PID=$!\n\
echo "Docker daemon started with PID $DOCKER_PID"\n\
\n\
# Wait for Docker to be ready (with timeout)\n\
echo "Waiting for Docker daemon to start..."\n\
timeout=30\n\
while [ $timeout -gt 0 ] && ! docker info > /dev/null 2>&1; do\n\
    echo "Docker not ready yet, waiting... ($timeout seconds left)"\n\
    sleep 1\n\
    timeout=$((timeout - 1))\n\
done\n\
\n\
if [ $timeout -eq 0 ]; then\n\
    echo "ERROR: Docker daemon failed to start within timeout at $(date)"\n\
    echo "Docker daemon logs:"\n\
    cat /tmp/dockerd.log\n\
    kill $DOCKER_PID 2>/dev/null || true\n\
    exit 1\n\
fi\n\
\n\
echo "Docker daemon started successfully at $(date)"\n\
docker info | head -10\n\
\n\
# Test SSH daemon configuration\n\
echo "Testing SSH daemon configuration at $(date)..."\n\
if ! /usr/sbin/sshd -t; then\n\
    echo "ERROR: SSH daemon configuration test failed"\n\
    exit 1\n\
fi\n\
echo "SSH configuration test passed"\n\
\n\
# Start SSH daemon\n\
echo "Starting SSH daemon at $(date)..."\n\
echo "SSH will be available on port 22"\n\
echo "Startup complete at $(date)"\n\
exec /usr/sbin/sshd -D -e\n\
' > /start.sh && chmod +x /start.sh

CMD ["/start.sh"]