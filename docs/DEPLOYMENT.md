# Deployment — free tier, full features (video calls included)

**Architecture:** everything on one Oracle Cloud *Always Free* ARM VM
(2 OCPU / 12 GB — Oracle reduced the old 4/24 allowance; still the only
free tier with a public IP + UDP, which mediasoup needs). One `docker compose` stack: Mongo, Redis, Kafka, MinIO,
the backend, and Caddy serving the built frontend + terminating HTTPS +
proxying `/api`, `/socket.io` and `/s3`. Same-origin end to end — no CORS.

**GitHub's role:** `main` is the deployable truth. CI (lint + 187 tests +
build) gates every PR; a push to `main` triggers `deploy.yml`, which SSHes
into the VM and rebuilds. Merge = deploy.

Files involved (all in this repo):

| File | Purpose |
|---|---|
| `backend/Dockerfile` | prod image; compiles mediasoup worker (needs glibc + toolchain) |
| `frontend/Dockerfile` | builds Vite app → Caddy image serves it |
| `deploy/Caddyfile` | HTTPS + routing (SPA, /api, /socket.io, /s3) |
| `docker-compose.prod.yml` | the whole stack |
| `.env.production.example` | template for the server's `.env.production` |
| `.github/workflows/ci.yml` | PR gate: lint + tests + build |
| `.github/workflows/deploy.yml` | push-to-main → SSH → rebuild |

---

## Phase 0 — branches & protection (once)

1. Create `develop` from `main`, push it.
2. PR `chore/socket-hardening` → `develop` (merge commit, don't squash), then PR `develop` → `main`.
3. GitHub → Settings → Branches → New ruleset for `main`:
   require a pull request + require the **CI / Backend** and **CI / Frontend**
   status checks. Untested code now cannot reach `main` (and so cannot deploy).

## Phase 1 — the server (once, ~45 min)

1. **Oracle account**: signup.oraclecloud.com (card for identity only; the
   Always-Free shapes never bill). Region: pick one near you and STAY on
   Always Free eligible shapes.
2. **VM**: Compute → Create instance → image *Ubuntu 22.04*, shape
   *VM.Standard.A1.Flex* (2 OCPU, 12 GB — the current Always-Free maximum;
   the stack idles at ~4 GB, so this fits). Upload/generate an SSH key. Note
   the **public IP**.

   **Free-tier facts** (per Oracle's docs): the signup card is identity
   verification only — a free account is HARD-CAPPED and cannot be charged;
   exceeding a limit fails the request instead of billing. Charges are only
   possible after an explicit Pay-As-You-Go upgrade. Egress allowance is
   10 TB/month. Idle instances (<20% CPU/RAM/network for 7 days) can be
   reclaimed — this stack's resting footprint stays above that line.
   If RAM/CPU headroom is ever needed: dropping Kafka+Zookeeper frees
   ~1.5 GB (it's an analytics side-channel behind one env flag).
3. **Network** (VCN → the subnet's Security List → Ingress rules):
   - TCP 80, 443 from 0.0.0.0/0
   - UDP 443 from 0.0.0.0/0 (HTTP/3, optional)
   - UDP 40000–40100 from 0.0.0.0/0 (mediasoup RTC)
   (TCP 22 exists by default.)
4. **On the VM** (ssh `ubuntu@<ip>`):
   ```bash
   sudo iptables -F   # Oracle Ubuntu images ship restrictive host rules; compose manages its own
   sudo netfilter-persistent save
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu && exit   # re-login so the group applies
   git clone https://github.com/PrakharDhyani/ConnectSphere.git ~/connectsphere
   cd ~/connectsphere
   cp .env.production.example .env.production
   nano .env.production   # fill EVERY <...> — see the template's comments
   ```
5. **Domain**: free option — duckdns.org → create `yourname.duckdns.org` →
   point it at the VM IP. Put that hostname in `.env.production` (`DOMAIN`,
   `SERVER_URL`, `CLIENT_URL`, `S3_PUBLIC_URL`, `GOOGLE_CALLBACK_URL`).
6. **Email**: resend.com free tier → API key → SMTP values in the template.
7. **Google OAuth**: add the prod callback URL in the Google Cloud console.
8. **First boot** (manual, so you see it work):
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   docker compose -f docker-compose.prod.yml ps    # everything "running"?
   ```
   Visit `https://<domain>` — Caddy fetches the certificate on first request.
   Create the MinIO bucket once:
   ```bash
   docker compose -f docker-compose.prod.yml exec minio sh -c \
     'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mb -p local/avatars && mc anonymous set download local/avatars'
   ```

## Phase 2 — GitHub auto-deploy (once, ~10 min)

1. Generate a deploy-only keypair **on your machine**:
   ```powershell
   ssh-keygen -t ed25519 -f deploy_key -N '""'
   ```
2. Append `deploy_key.pub`'s content to `~/.ssh/authorized_keys` **on the VM**.
3. GitHub → Settings → Secrets and variables → Actions → New repository secret ×3:
   - `DEPLOY_HOST` = the VM public IP
   - `DEPLOY_USER` = `ubuntu`
   - `DEPLOY_SSH_KEY` = the **private** `deploy_key` file's full content
4. Delete the local `deploy_key` files once the secret is saved.

## Phase 3 — the loop (forever)

```
feature branch → PR to develop (CI gates) → PR develop → main → auto-deploy
```
Watch deploys in the **Actions** tab. A failed deploy leaves the previous
version running. Roll back = revert the merge commit on `main` and push —
the workflow redeploys the old code.

## Ops crib sheet (on the VM)

```bash
alias prod='docker compose -f docker-compose.prod.yml --env-file .env.production'
prod logs -f backend        # live backend logs
prod ps                     # stack health
prod restart backend        # bounce one service
prod down                   # stop everything (volumes/data survive)
docker system df            # disk usage
```

**Backups (free):** Mongo data lives in the `mongo_data` volume. Weekly:
`prod exec mongo mongodump --archive | gzip > backup-$(date +%F).gz` — and
copy it off the VM.
