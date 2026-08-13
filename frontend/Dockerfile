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

# ── Build-time configuration ────────────────────────────────────────────────
# Vite INLINES `import.meta.env.VITE_*` into the bundle at build time. That
# makes them fundamentally different from the backend's runtime env vars: a
# value supplied in docker-compose `environment:` arrives far too late — the
# bundle was already written. It has to be an ARG, present during `npm run
# build`, or it silently ends up as an empty string.
#
# "Silently" is the operative word: the GIF picker falls back to OtakuGIFs and
# the local SVG set when the key is absent, so nothing errors and nothing logs.
# Production just quietly has a worse GIF search than dev, which is exactly the
# kind of difference nobody notices for months.
#
# NOT A SECRET. It is a free, client-side search key that ships inside the
# bundle by design — anyone can read it from devtools. Do not put anything
# genuinely sensitive here; browser-visible is browser-visible.
ARG VITE_KLIPY_KEY=""
ENV VITE_KLIPY_KEY=$VITE_KLIPY_KEY

RUN npm run build

FROM caddy:2-alpine
COPY --from=builder /app/dist /srv
# deploy/Caddyfile is mounted by docker-compose.prod.yml so routing
# rules can change without rebuilding this image.
