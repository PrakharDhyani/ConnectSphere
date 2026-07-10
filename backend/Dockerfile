# ============================================================
# ConnectSphere Backend — Dockerfile
#
# Multi-stage build:
#   Stage 1 (builder) — install ALL deps including devDeps
#   Stage 2 (runner)  — copy only production deps + built code
#
# Why multi-stage?
#   The final image is ~200MB smaller because devDependencies
#   (nodemon, eslint, jest, etc.) are NOT included.
# ============================================================

# ── Stage 1: Builder ──────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first (Docker layer caching trick:
# if package.json doesn't change, npm install layer is reused)
COPY package*.json ./
RUN npm ci --only=production

# ── Stage 2: Runner ───────────────────────────────────────
FROM node:20-alpine AS runner

# Create non-root user for security
# Running as root in a container is a security risk
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source code
COPY src/ ./src/
COPY package*.json ./

# Switch to non-root user
USER appuser

# Document which port the app listens on
EXPOSE 5000

# Health check for Docker / k8s
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "src/index.js"]

