FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Copy application
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY dist/ ./dist/

# Make AL CLI available
ENV PATH="/app/dist/cli:${PATH}"
ENV NODE_PATH="/app/node_modules"

# Use the built-in node user (uid 1000) instead of root
USER node

ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
