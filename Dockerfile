# Stage 1 — Build
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/daemon/package.json packages/daemon/
COPY packages/frontend/package.json packages/frontend/

RUN npm ci

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/daemon/ packages/daemon/
COPY packages/frontend/ packages/frontend/

# Build: shared → daemon → frontend
RUN npm run build

# Copy non-TS assets (prompt .md files) into daemon dist
RUN find packages/daemon/src -name '*.md' | while read f; do \
      cp "$f" "packages/daemon/dist/${f#packages/daemon/src/}"; \
    done

# Stage 2 — Runtime
FROM node:20-slim

LABEL org.opencontainers.image.source="https://github.com/matthias-trip/holms"
LABEL org.opencontainers.image.description="Holms — AI-driven home automation"
LABEL org.opencontainers.image.licenses="MIT"

# Git is needed by the Claude Agent SDK's bundled CLI at runtime
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace structure
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/daemon/package.json packages/daemon/
COPY packages/frontend/package.json packages/frontend/

# Copy built artifacts
COPY --from=builder /app/packages/shared/src/ packages/shared/src/
COPY --from=builder /app/packages/daemon/dist/ packages/daemon/dist/
COPY --from=builder /app/packages/frontend/dist/ packages/frontend/dist/

# Copy node_modules (hoisted by npm workspaces to root)
COPY --from=builder /app/node_modules/ node_modules/

# Pre-configure Claude CLI for headless operation:
# - hasCompletedOnboarding: skip interactive setup prompts
# - installMethod: prevent auto-updater from trying to install native binary
RUN mkdir -p /root/.claude/debug
RUN echo '{"hasCompletedOnboarding":true,"installMethod":"sdk","autoUpdaterStatus":"disabled"}' > /root/.claude.json

# Environment defaults
ENV HOLMS_PORT=3100
ENV HOLMS_DB_PATH=/data/holms.db
ENV HOLMS_HISTORY_DB_PATH=/data/holms-history.duckdb
ENV HOLMS_HF_CACHE_DIR=/models
ENV HOLMS_FRONTEND_DIST=/app/packages/frontend/dist
ENV HOLMS_PLUGINS_DIR=/plugins

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/trpc').catch(()=>process.exit(1))"

WORKDIR /app/packages/daemon
CMD ["node", "dist/index.js"]
