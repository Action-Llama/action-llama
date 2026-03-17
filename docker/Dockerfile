# syntax=public.ecr.aws/docker/dockerfile:1
FROM public.ecr.aws/docker/library/node:20-alpine

ARG GIT_SHA=unknown
ARG VERSION=unknown

RUN apk add --no-cache git curl jq ca-certificates openssh-client

# Copy application
WORKDIR /app
COPY package.json ./
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev --omit=optional
COPY dist/ ./dist/

# Bake shell scripts into image so container-entry doesn't write them at runtime
COPY docker/bin/ /app/bin/

LABEL org.opencontainers.image.revision=$GIT_SHA
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.source="https://github.com/action-llama/action-llama"

# Use the built-in node user (uid 1000) instead of root
USER node

ENTRYPOINT ["node", "/app/dist/agents/container-entry.js"]
