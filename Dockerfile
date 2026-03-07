# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace manifests + lockfile for deterministic install
COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/

# Install all deps (including devDeps needed for tsc)
RUN pnpm install --filter @letmecook/api --frozen-lockfile

# Copy source and compile TypeScript → dist/
COPY apps/api ./apps/api
RUN cd apps/api && pnpm build

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

RUN npm install -g pnpm
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y git curl && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Install Gemini CLI and create default settings
RUN npm install -g @google/gemini-cli && \
    mkdir -p /root/.gemini && \
    echo '{"security":{"auth":{"selectedType":"oauth-personal"}},"hasSeenIdeIntegrationNudge":true,"general":{"sessionRetention":{"enabled":true,"maxAge":"30d","warningAcknowledged":true}},"ide":{"hasSeenNudge":true}}' > /root/.gemini/settings.json

WORKDIR /app

COPY pnpm-workspace.yaml .npmrc package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/

# Production deps only — no tsx needed at runtime
RUN pnpm install --filter @letmecook/api --prod --frozen-lockfile

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy SQL migration files (not emitted by tsc)
COPY apps/api/src/db/migrations ./apps/api/dist/db/migrations

# Copy logo for code-server favicon
COPY apps/web/public/logo.png ./apps/api/dist/logo.png

RUN mkdir -p /app/data /app/data/projects

EXPOSE 3000

ENV NODE_ENV=production

WORKDIR /app/apps/api
CMD ["sh", "-c", "node dist/worker.js & node dist/index.js"]
