FROM node:20-alpine

# Install dependencies needed for Action Llama
RUN apk add --no-cache git bash curl openssh-client

# Create app directory
WORKDIR /app

# Copy the built action-llama package
COPY packages/action-llama/dist ./action-llama/dist
COPY packages/action-llama/package.json ./action-llama/
COPY packages/shared/dist ./shared/dist
COPY packages/shared/package.json ./shared/

# Install action-llama globally
RUN cd action-llama && npm pack && npm install -g *.tgz

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