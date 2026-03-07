FROM public.ecr.aws/docker/library/node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Copy application
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY dist/ ./dist/

# Create /workspace so container-entry can chdir into it regardless of runtime
RUN mkdir -p /workspace && chown node:node /workspace

# Use the built-in node user (uid 1000) instead of root
USER node

ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
