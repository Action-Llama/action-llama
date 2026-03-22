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

# Start script that runs SSH and Docker daemon
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Start Docker daemon in background\n\
dockerd &\n\
\n\
# Wait for Docker to be ready\n\
while ! docker info > /dev/null 2>&1; do\n\
    echo "Waiting for Docker daemon to start..."\n\
    sleep 1\n\
done\n\
\n\
# Start SSH daemon\n\
exec /usr/sbin/sshd -D\n\
' > /start.sh && chmod +x /start.sh

CMD ["/start.sh"]