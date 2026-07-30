# ============================================================
# Groot Backend — production image
#
# Multi-stage: deps are installed (and mediasoup's C++ worker is
# COMPILED) in a stage with a toolchain; the runtime stage is the
# same slim base without it.
#
# Why bookworm-slim and not alpine: mediasoup's worker targets
# glibc — on musl (alpine) there are no prebuilts and source
# builds are unsupported. On ARM VMs (Oracle Ampere) it compiles
# from source, which is why python3/make/g++ are here.
# ============================================================

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package*.json ./
# The base image ships a non-root "node" user — never run as root.
USER node
EXPOSE 5000
CMD ["node", "src/index.js"]
