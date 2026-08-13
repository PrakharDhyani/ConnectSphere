# Deployment — free tier, full features (video calls included)

**Architecture:** everything on one Oracle Cloud *Always Free* ARM VM. One
`docker compose` stack: Mongo, Redis, Kafka+Zookeeper, MinIO, the Node backend,
and Caddy serving the built frontend + terminating HTTPS + proxying `/api`,
`/socket.io` and `/s3`. Same-origin end to end — no CORS anywhere.

**GitHub's role:** `main` is the deployable truth. CI (lint + tests + build)
gates every PR; a push to `main` triggers `deploy.yml`, which SSHes into the VM
and rebuilds. **Merge = deploy.**

---

## Why a VM, and not Render / Railway / Vercel / Fly

This is the one architectural constraint that decides the whole hosting
question, so it is worth stating plainly:

> **mediasoup needs a public IP with raw UDP ingress on a port range.**

Not WebSocket-tunnelled, not "UDP-like" — actual UDP datagrams arriving on ports
40000–40100. Every platform that fronts you with an HTTP/TCP router (Render,
Railway, Vercel, Netlify, Heroku) **cannot** do this, and no amount of
configuration changes it. Video calls would fail to connect, and everything else
would look fine — which is the worst way for a constraint to announce itself.

Fly.io technically supports UDP but requires a dedicated IPv4, forbids shared
IPs, needs the app bound to `fly-global-services`, and its docs never confirm
that a 101-port range can be declared. Not worth the risk for this.

**So: a VM.** The stateful compose stack (Mongo/Kafka/MinIO) wants one anyway.

### Host comparison (verified August 2026)

| Option | RAM | Cost/mo | Verdict |
|---|---|---|---|
| **Oracle A1 Always Free** | **12 GB** | **$0** | **Recommended.** 10 TB egress, free IPv4, full UDP ranges |
| Contabo VPS | 8 GB | ~€4.50 | Best paid fallback — no capacity lottery |
| Hetzner CX33 | 8 GB | ~€10 | Better network, double the price |
| GCP e2-micro | 1 GB | $0 | ✗ too small (stack idles ~4 GB) |
| AWS EC2 | — | — | ✗ the 12-month free tier **closed to new accounts** in July 2025 |
| Render / Railway / Vercel | — | — | ✗ no raw UDP — see above |

> ⚠️ **Oracle halved the Always Free ARM allowance on 15 June 2026**: 4 OCPU /
> 24 GB → **2 OCPU / 12 GB**, with instances above the new limit facing
> termination. 12 GB still fits this stack (~4 GB at rest) comfortably. If you
> have an older, larger instance, resize it.

---

## Files involved (all in this repo)

| File | Purpose |
|---|---|
| `backend/Dockerfile` | prod image; mediasoup worker needs glibc + toolchain |
| `frontend/Dockerfile` | builds the Vite app → Caddy image serves it |
| `deploy/Caddyfile` | HTTPS + routing (SPA, `/api`, `/socket.io`, `/s3`) |
| `docker-compose.prod.yml` | the whole stack |
| `.env.production.example` | template for the server's `.env.production` |
| `.github/workflows/ci.yml` | PR gate: lint + tests + build |
| `.github/workflows/deploy.yml` | push-to-main → SSH → rebuild |

---

## Phase 0 — branch protection (once, ~5 min)

GitHub → Settings → Branches → New ruleset for `main`: require a pull request,
and require the **CI / Backend** and **CI / Frontend** status checks.

Untested code now cannot reach `main`, and therefore cannot deploy. This matters
more than usual here precisely *because* merging deploys automatically.

---

## Phase 1 — the server (once, ~45 min)

### 1.1 Oracle account

signup.oraclecloud.com. The card is **identity verification only** — an Always
Free account is hard-capped and cannot be charged; exceeding a limit fails the
request rather than billing you.

> **Choose your home region carefully — it is fixed at signup and cannot be
> changed.** ARM capacity varies by region; Frankfurt and Singapore are
> reported healthiest. If you hit "Out of host capacity", that is normal for A1
> shapes: retry over hours, or use a polling script such as
> `hitrov/oci-arm-host-capacity`.

### 1.2 Create the VM

Compute → Instances → Create instance:

- **Image:** Ubuntu 22.04
- **Shape:** `VM.Standard.A1.Flex` — **2 OCPU / 12 GB** (the current maximum)
- **SSH key:** upload your public key (or let Oracle generate one and download it)
- Note the **public IP**.

> **Immediately after provisioning, consider upgrading to Pay-As-You-Go.**
> Always Free instances are reclaimed if idle (95th-percentile CPU **and**
> network **and** memory all under 20% across 7 days). PAYG exempts you from
> reclamation and **still costs nothing** while you stay inside Always Free
> limits. The trade-off is a billable account — your call.

### 1.3 Open the firewall — BOTH layers

This is the single most common cause of "everything works except video calls".
Oracle has **two** independent firewalls and you must open both.

**(a) OCI Security List** — VCN → your subnet → Security List → Ingress rules:

| Source | Protocol | Port | Purpose |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 80 | HTTP (Let's Encrypt challenge + redirect) |
| `0.0.0.0/0` | TCP | 443 | HTTPS |
| `0.0.0.0/0` | UDP | 443 | HTTP/3 (optional) |
| `0.0.0.0/0` | **UDP** | **40000–40100** | **mediasoup RTC — calls fail without this** |

(TCP 22 already exists by default.)

**(b) The instance's own firewall.** Oracle's Ubuntu images ship with
restrictive `iptables` rules that silently drop the above:

```bash
ssh ubuntu@<PUBLIC_IP>

# Inspect what is there before changing it.
sudo iptables -L INPUT -n --line-numbers

# Open exactly what the stack needs (preferred over flushing everything).
sudo iptables -I INPUT 1 -p tcp --dport 80   -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443  -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 443  -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 40000:40100 -j ACCEPT

# Persist across reboots, or every restart silently breaks calls again.
sudo apt-get update && sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

> Older guides say `sudo iptables -F` (flush everything). That works and is
> simpler, but it also removes Oracle's default protections — and if you skip
> `netfilter-persistent save`, the rules come back on reboot and calls break
> with no code change to blame. Prefer the targeted rules above.

### 1.4 Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit                      # re-login so the group membership applies
ssh ubuntu@<PUBLIC_IP>
docker --version && docker compose version   # verify
```

### 1.5 Domain + DNS

Point an **A record** at the VM's public IP. Free option: duckdns.org →
`yourname.duckdns.org`.

Verify before continuing — Caddy cannot obtain a certificate until DNS resolves:

```bash
dig +short yourname.duckdns.org     # must print your VM's IP
```

### 1.6 Clone and configure

```bash
git clone https://github.com/PrakharDhyani/ConnectSphere.git ~/connectsphere
cd ~/connectsphere
cp .env.production.example .env.production
nano .env.production
```

**The values that must be right, or things fail quietly:**

| Variable | Value | Why it matters |
|---|---|---|
| `DOMAIN` | `yourname.duckdns.org` | Caddy's cert + vhost |
| `SERVER_URL` / `CLIENT_URL` | `https://yourname.duckdns.org` | links in emails, OAuth |
| `S3_PUBLIC_URL` | `https://yourname.duckdns.org/s3` | avatars load over the SAME origin (no mixed content) |
| **`MEDIASOUP_ANNOUNCED_IP`** | **the VM's public IP** | ⚠️ **the address handed to browsers for media.** Leave it `127.0.0.1` and calls fail with no error |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | fresh random | never reuse the dev values |
| `MONGO_URI` | `mongodb://mongo:27017/connectsphere` | service name, not localhost |
| `LIBRETRANSLATE_URL` | **empty** | prod compose has no such service; empty = 501, captions still work |

Generate the JWT secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run twice
```

**Optional, all degrade gracefully if left empty:**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth routes return 501 without them. If used, add `https://<domain>/api/auth/google/callback` to the Google Cloud console's authorised redirect URIs.
- `VAPID_*` — Web Push. Generate with `npx web-push generate-vapid-keys`.
- `SMTP_*` — verification/reset emails. resend.com free tier is 3,000/month.
- `VITE_KLIPY_KEY` — **build-time**, not runtime (Vite inlines it into the bundle). Empty = GIF search falls back to OtakuGIFs + built-in SVGs. It ships inside the bundle, so it is public by design — never put a real secret in a `VITE_*` variable.

### 1.7 First boot — manually, so you see it work

```bash
cd ~/connectsphere
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The first build takes 5–15 minutes on ARM (mediasoup compiles a C++ worker).

```bash
docker compose -f docker-compose.prod.yml ps          # every service "running"?
docker compose -f docker-compose.prod.yml logs -f backend
```

Wait for `🚀 Groot backend running on port 5000`.

### 1.8 Create the MinIO bucket (once)

Avatars and chat attachments need it to exist:

```bash
docker compose -f docker-compose.prod.yml exec minio sh -c \
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
   && mc mb -p local/connectsphere \
   && mc anonymous set download local/connectsphere'
```

### 1.9 Verify — do not skip this

```bash
# 1. API is up (from the VM)
curl -s http://localhost:5000/api/health

# 2. HTTPS + certificate (from your laptop)
curl -sI https://yourname.duckdns.org | head -3

# 3. The UDP range is actually open (from your laptop).
#    An open UDP port usually stays SILENT; a CLOSED one answers with ICMP
#    port-unreachable. "no response" here is the good outcome.
nmap -sU -p 40000 yourname.duckdns.org
```

Then in a browser, and this is the part that matters:

1. Register an account → confirm you land on the dashboard.
2. Create a room, open it in **two** browsers (or one normal + one private
   window, logged in as different users).
3. **Start a video call and confirm you see and hear each other.** This is the
   only real test of `MEDIASOUP_ANNOUNCED_IP` + the UDP firewall rules — every
   other feature works fine while media is broken.

---

## Phase 2 — GitHub auto-deploy (once, ~10 min)

Only wire this up **after** a successful manual deploy. Otherwise a failing
workflow gives you two problems to debug instead of one.

**1. Generate a deploy-only keypair** (on your laptop):

```powershell
ssh-keygen -t ed25519 -f deploy_key -N '""' -C "github-actions-deploy"
```

**2. Authorise it on the VM:**

```bash
# paste the CONTENTS of deploy_key.pub
echo "ssh-ed25519 AAAA... github-actions-deploy" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**3. Test it before trusting CI with it:**

```powershell
ssh -i deploy_key ubuntu@<PUBLIC_IP> "echo deploy key works"
```

**4. Add three repository secrets** — GitHub → Settings → Secrets and variables
→ Actions:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the VM's public IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | the **entire private** `deploy_key` file, including the BEGIN/END lines |

**5. Delete the local key files** once the secret is saved:

```powershell
Remove-Item deploy_key, deploy_key.pub
```

---

## Phase 3 — the loop (forever)

```
feature branch → PR to develop (CI gates) → PR develop → main → auto-deploy
```

Watch deploys in the **Actions** tab. A failed deploy leaves the previous
containers running — a red X never takes the site down.

**Rollback:** revert the merge commit on `main` and push. The workflow
redeploys the previous code.

```bash
git revert -m 1 <merge-commit-sha>
git push origin main
```

---

## TURN (only if calls fail on restrictive networks)

mediasoup is an SFU, so most calls connect directly to the VM. Users behind
symmetric NAT or corporate firewalls may still need a TURN relay.

**Run coturn on the same VM** — you already have the public IP, and Oracle's
10 TB/month egress makes it effectively free. Do **not** rely on Metered.ca's
free tier: 500 MB/month is roughly 35 minutes of one relayed call.

---

## Ops crib sheet (on the VM)

```bash
alias prod='docker compose -f docker-compose.prod.yml --env-file .env.production'

prod ps                     # stack health
prod logs -f backend        # live backend logs
prod restart backend        # bounce one service
prod down                   # stop everything (volumes/data survive)
prod up -d --build          # rebuild after a manual code change
docker system df            # disk usage
docker image prune -f       # reclaim space after rebuilds
```

**Backups (free).** Mongo data lives in the `mongo_data` volume:

```bash
prod exec -T mongo mongodump --archive --gzip > backup-$(date +%F).gz
```

Copy it off the VM — a backup on the same disk is not a backup.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **Everything works except video** | `MEDIASOUP_ANNOUNCED_IP` wrong, or UDP 40000–40100 closed in one of the two firewalls | Set it to the public IP; open the range in **both** the OCI security list and `iptables`; `prod restart backend` |
| Video broke after a reboot | `iptables` rules were not persisted | `sudo netfilter-persistent save` |
| Certificate never issues | DNS not resolving yet, or TCP 80 closed | `dig +short <domain>`; Let's Encrypt needs port 80 reachable |
| `dependency failed to start: kafka is unhealthy` | Kafka is slow on a cold boot and misses its healthcheck window | Wait ~60s and re-run `up -d` |
| Avatars/attachments 404 | MinIO bucket missing, or `S3_PUBLIC_URL` wrong | Re-run step 1.8; confirm it is `https://<domain>/s3` |
| Emails never arrive | `SMTP_*` unset | Expected — auth still works, verification links appear in the backend logs |
| Deploy workflow fails on SSH | Key mismatch or `DEPLOY_SSH_KEY` missing its BEGIN/END lines | Re-test with `ssh -i deploy_key`; paste the whole file |
| Out of disk after several deploys | Old images accumulate | `docker image prune -f` (the workflow already does this) |
| "Out of host capacity" creating the VM | Normal for A1 shapes | Retry over hours, or use a capacity-polling script |
