# syntax=docker/dockerfile:1
FROM public.ecr.aws/docker/library/node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    jq \
    ca-certificates \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Copy application
WORKDIR /app
COPY package.json ./
RUN --mount=type=cache,target=/root/.npm npm install --production
COPY dist/ ./dist/

# Use the built-in node user (uid 1000) instead of root
USER node

ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
