FROM node:20-alpine

# Install dependencies needed for Action Llama
RUN apk add --no-cache git bash curl openssh-client rsync tar

# Create app directory
WORKDIR /app

# Copy the built action-llama package
COPY packages/action-llama/dist ./action-llama/dist
COPY packages/action-llama/drizzle ./action-llama/drizzle
COPY packages/action-llama/package.json ./action-llama/
COPY packages/shared/dist ./shared/dist
COPY packages/shared/package.json ./shared/

# Install action-llama globally, plus c8 for optional coverage instrumentation
RUN cd action-llama && npm pack && npm install -g *.tgz c8

# Mock Docker CLI — the scheduler needs Docker to pass startup checks and to
# provision + connect to agent containers via the transport layer.
# This mock handles the key commands:
#   info   — startup check
#   run    — container provisioning (returns fake container ID)
#   exec   — transport connection (runs the command directly in this container)
#   cp     — file transfer (performs the copy locally)
#   rm     — container cleanup (no-op)
#   build/image/tag/network/ps — legacy compat (no-op or echo)
COPY packages/e2e/docker/local/mock-docker.sh /usr/local/bin/docker
RUN chmod +x /usr/local/bin/docker

# Set up test environment
ENV NODE_ENV=test
ENV AL_TEST_MODE=1
ENV AL_MOCK_CREDENTIALS=1
ENV AL_DISABLE_ANALYTICS=1

# Create a non-root user for testing
RUN addgroup -g 1001 -S testuser && \
    adduser -S testuser -u 1001 -G testuser && \
    mkdir -p /workspace /credentials && \
    chown testuser:testuser /workspace /credentials

USER testuser
WORKDIR /home/testuser

# Keep container running
CMD ["tail", "-f", "/dev/null"]