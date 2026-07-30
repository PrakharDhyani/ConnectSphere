# ============================================================
# Groot Web — builds the Vite app, serves it with Caddy.
#
# Caddy (not nginx) because it is ALSO the platform's front door
# in production: automatic HTTPS (Let's Encrypt, zero config),
# static files, and reverse-proxying /api + /socket.io to the
# backend — all in one container. That keeps the app SAME-ORIGIN,
# so the axios baseURL "/api", the socket.io default URL and the
# cookie flow all work in production exactly as in dev (where the
# Vite proxy plays this role). No CORS configuration anywhere.
# ============================================================

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=builder /app/dist /srv
# deploy/Caddyfile is mounted by docker-compose.prod.yml so routing
# rules can change without rebuilding this image.
