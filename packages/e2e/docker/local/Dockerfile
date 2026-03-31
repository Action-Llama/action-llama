FROM node:20-alpine

# Install dependencies needed for Action Llama
RUN apk add --no-cache git bash curl openssh-client rsync

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

# Mock Docker CLI — scheduler checks docker at startup and during image builds
# Docker isn't available in the test container, but the scheduler needs it to pass init
# This mock makes all docker commands succeed, faking image existence and builds
RUN printf '#!/bin/bash\ncase "$1" in\n  info) echo "Server Version: 24.0.0";;\n  network) echo "action-llama";;\n  image) echo "mock-image";;\n  build) echo "Successfully built mock-image";;\n  tag) ;;\n  ps) ;;\n  *) ;;\nesac\nexit 0\n' > /usr/local/bin/docker && chmod +x /usr/local/bin/docker

# Set up test environment
ENV NODE_ENV=test
ENV AL_TEST_MODE=1
ENV AL_MOCK_CREDENTIALS=1
ENV AL_DISABLE_ANALYTICS=1

# Create a non-root user for testing
RUN addgroup -g 1001 -S testuser && \
    adduser -S testuser -u 1001 -G testuser

USER testuser
WORKDIR /home/testuser

# Keep container running
CMD ["tail", "-f", "/dev/null"]