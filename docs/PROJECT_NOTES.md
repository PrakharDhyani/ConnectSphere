# ConnectSphere — Development Notes & Interview Prep

> A running journal of every feature: what it is, the implementation options we weighed,
> what we actually built, the challenges we hit, and how we verified it works.
> Written so that any section can be explained confidently in an interview.
>
> **Convention:** each feature section follows the same shape —
> **The Feature → Ways to Implement → What We Did → Challenges → Interview Q&A**.

---

## Table of Contents

1. [Project Overview & Architecture](#1-project-overview--architecture)
2. [Infrastructure: Docker Compose (Mongo, Redis, Kafka)](#2-infrastructure-docker-compose)
3. [Backend Scaffold & Design Decisions](#3-backend-scaffold--design-decisions)
4. [Git & GitHub Workflow](#4-git--github-workflow)
5. [Dependency Security (npm audit / Dependabot)](#5-dependency-security)
6. [Feature: User Model & Password Hashing](#6-feature-user-model--password-hashing)
7. [Feature: JWT Authentication (Register & Login)](#7-feature-jwt-authentication-register--login)
8. [Feature: Auth Middleware & Protected Routes](#8-feature-auth-middleware--protected-routes)
9. [Feature: Refresh Token Rotation & Logout (Redis)](#9-feature-refresh-token-rotation--logout-redis)
10. [Feature: Google OAuth 2.0](#10-feature-google-oauth-20)
11. [Testing / Verification Methodology](#11-testing--verification-methodology)

---

## 1. Project Overview & Architecture

**What:** ConnectSphere — a real-time video calling & collaboration platform (Zoom + Snapchat
filters + Figma whiteboard + mini-games in one browser tab).

**Stack:** MERN (MongoDB, Express, React 18 + Vite, Node 20) · WebRTC via mediasoup SFU ·
Socket.io · Redis · Kafka · Docker Compose · JWT + Google OAuth · AWS S3 · TensorFlow.js.

**High-level flow:**

```
React SPA (:3000) ──HTTP /api──▶ Express (:5000) ──▶ MongoDB   (users, rooms, messages)
        │                            │──▶ Redis     (refresh tokens, cache, socket scaling)
        └────socket.io / WebRTC──────┘──▶ Kafka     (async: recording, notifications)
```

**Key architectural choices (and why):**
- **Backend on host, infra in Docker (dev):** Node runs via `npm run dev` for fast
  reload; Mongo/Redis/Kafka run as containers so nothing is installed natively.
- **`app.js` vs `index.js` split:** `app.js` builds/configures the Express app,
  `index.js` boots connections + HTTP server. Lets tests import the app without
  starting a server.
- **Boot order:** Mongo → Redis → Kafka → HTTP listen. The server refuses traffic
  until every dependency is connected (fail-fast on startup rather than at request time).
- **Vite dev proxy:** `/api` and `/socket.io` proxied from :3000 → :5000, so the
  frontend calls relative URLs and CORS never bites in dev.

---

## 2. Infrastructure: Docker Compose

### The Feature
One `docker-compose.yml` that brings up MongoDB 7, Redis 7.2, ZooKeeper, Kafka
(Confluent 7.6), and a Kafka UI — each with healthchecks, named volumes, and one
shared bridge network.

### Ways to Implement
1. Install everything natively on Windows — version drift, painful cleanup, "works on my machine."
2. **Docker Compose (chosen)** — declarative, reproducible, disposable (`down -v` resets everything).
3. Cloud-hosted dev services (Atlas, Upstash…) — needless cost/latency for local dev.

### What We Did
- Healthchecks per service (`mongosh ping`, `redis-cli ping`, Kafka topic list), so
  `depends_on: condition: service_healthy` gates startup ordering (Kafka waits for ZooKeeper).
- Named volumes for persistence across restarts.
- **Kafka dual listeners** — the subtle part:
  - `PLAINTEXT_HOST://localhost:9092` → for clients on the host machine (our backend in dev)
  - `PLAINTEXT://kafka:9093` → for clients inside the Docker network
  - Why: Kafka hands clients an *advertised address* to reconnect to. If a host client
    got told "kafka:9093" it couldn't resolve it; if a container got "localhost:9092" it
    would call itself. Two listeners solve both.

### Challenges
1. **Image pulls kept failing with `httpReadSeeker ... EOF`.** All four images failed
   identically → not random flakiness. Root cause: Docker Desktop's *containerd image
   store* streams layers via HTTP range requests, which is fragile on an unstable
   connection. Fix: Settings → General → uncheck "Use containerd for pulling and
   storing images" → classic puller downloads whole layers and tolerates blips. All
   images pulled immediately after.
2. **ZooKeeper stuck `unhealthy`, blocking Kafka.** Healthcheck ran
   `echo ruok | nc localhost 2181 | grep imok`, but ZK 3.5+ disables most
   "four-letter-word" commands by default; the log showed only `srvr` whitelisted.
   First attempt: set `ZOOKEEPER_4LW_COMMANDS_WHITELIST=ruok,srvr,stat` — **had zero
   effect.** Debugged by reading the image's config template
   (`/etc/confluent/docker/zookeeper.properties.template`) inside the container: the
   Confluent image maps only a **hardcoded list** of env vars into config, and the 4LW
   whitelist var isn't one of them. Fix: don't fight the image — switch the healthcheck
   to the already-enabled command: `echo srvr | nc localhost 2181 | grep Mode`.
   **Lesson:** when a config env var "doesn't work," check whether the image's
   entrypoint actually maps it.
3. **Obsolete `version: "3.9"` key** — Compose v2 ignores it with a warning; deleted.
4. **Git Bash path mangling** — running `docker exec cs_zookeeper cat /etc/kafka/...`
   from Git Bash rewrote `/etc/kafka` into `C:/Program Files/Git/etc/kafka`. Fix:
   `MSYS_NO_PATHCONV=1` before the command.

### Interview Q&A
- *Why Kafka at all?* Decouples heavy async work (recording pipeline → ffmpeg → S3,
  notifications, analytics) from the request path; persistent + replayable, unlike Redis pub/sub.
- *Why both Redis and Kafka?* Redis = low-latency state/cache/pub-sub (ephemeral);
  Kafka = durable ordered event log for pipelines. Different tools, different jobs.
- *What does a healthcheck actually change?* "Container started" ≠ "service ready."
  Healthchecks make `depends_on` wait for *ready*, killing a whole class of races.

---

## 3. Backend Scaffold & Design Decisions

### What We Did
- **Express middleware order** (order matters — it's a pipeline):
  `helmet` (security headers) → `cors` (allowlist + credentials) → global rate limit
  → JSON/urlencoded body parsers → `cookie-parser` → passport init → request logging
  (morgan → winston) → routes → 404 → central error handler.
- **Central error handler:** any middleware/controller calls `next(error)` with an
  `error.statusCode`; one place decides the response shape and hides stack traces in
  production. Controllers stay thin.
- **Structured logging (winston):** JSON logs with daily-rotating files (14d retention,
  30d for errors) + colorized console in dev. JSON logs are machine-ingestable
  (Loki/CloudWatch) — `console.log` is not.
- **Rate limiting in layers:** global 300 req/15min per IP; auth endpoints get a
  stricter 20/15min (they're brute-force targets).

### Challenges
- **ESLint 9 peer-dependency conflict:** scaffold pinned `eslint@^9` with
  `eslint-plugin-react-hooks@^4.6.2`, whose peer range stops at ESLint 8 → `npm install`
  refused (ERESOLVE). Options: downgrade to ESLint 8 / `--legacy-peer-deps` (papers over
  it) / **upgrade properly (chosen)**: `eslint-plugin-react-hooks@^5`, plus the new
  **flat config** (`eslint.config.js`) that ESLint 9 requires, for both packages.
- **`HomePage.jsx` casing bug:** `App.jsx` imported `HomePage.jsx`, file was
  `Homepage.jsx`. Works on Windows (case-insensitive FS), **breaks on Linux/CI/Docker**.
  Renamed the file to match. Classic cross-platform trap worth telling in interviews.
- **`.env` host-vs-container values:** `.env.example` used Docker service names
  (`mongo`, `redis`, `kafka:9092`) but the backend runs on the host, where those names
  don't resolve (and the Kafka port was wrong for either context). Fixed to `localhost`
  values + documented the rule: host client → `localhost:9092`, containerized client →
  `kafka:9093`.

---

## 4. Git & GitHub Workflow

### The Setup
```
main      ← releases only (protected in spirit; only updated by deliberate merges)
develop   ← integration; every feature merges here via PR
feature/* ← one branch per feature (also fix/*, chore/*)
```
- **Conventional Commits** (`feat(auth): …`, `fix: …`, `chore: …`) — machine-parseable
  history, easy changelogs.
- Every change lands via **PR with a reviewable diff**, even solo — the "Files changed"
  self-review catches real mistakes.
- CI (GitHub Actions) lints backend + frontend on every push to `feature/**`/`develop` and PRs.

### Challenges (real ones we hit — great interview stories)
1. **PR merged into the wrong base.** PR #5 was meant for `develop` but GitHub defaults
   the base dropdown to the repo's default branch (`main`) — and it got merged there.
   Detected by reading the commit graph (`git log --graph --all`): `main` advanced,
   `develop` didn't. Fix: fast-forward `develop` up to `main` (safe because `develop`
   was a strict ancestor — no divergence). **Lesson:** always check the base dropdown;
   verify merges via the graph, not assumptions.
2. **Feature branch created from the wrong parent.** `feature/auth` was accidentally
   created while HEAD sat on a Dependabot branch — so it silently carried an unwanted
   `vite@8.1.4` bump. Spotted because `git log` showed `feature/auth` pointing at the
   Dependabot commit. Recovery: `git stash -u` (carry uncommitted work incl. untracked
   files) → sync `develop` → `git branch -D feature/auth` (safe: zero unique commits)
   → recreate from `develop` → `stash pop`. Zero work lost.
3. **A commit that missed its PR.** The multer bump was committed to the security-fix
   branch *after* its PR had already merged — so it never reached `main`. Found later
   via `git diff` showing multer still old on `main`. Fix: re-applied on the next branch.
   **Lesson:** after "merge," confirm the merged content is actually what you think.

### Interview Q&A
- *Why `develop` + `main` instead of trunk-based?* Solo-friendly practice for release
  discipline: `main` = shippable snapshots, `develop` = integration. (Would consider
  trunk-based with feature flags in a bigger team.)
- *Fast-forward vs merge commit?* FF possible only when target is a strict ancestor —
  pointer moves, no new commit. We used exactly this to repair `develop`.

---

## 5. Dependency Security

### What Happened
On first push, GitHub Dependabot flagged vulnerabilities and auto-opened 4 bot PRs.
We resolved them **manually, deliberately** instead of blind-merging bots:

| Package | Problem | Our fix (vs Dependabot's) |
|---|---|---|
| `aws-sdk` v2 | Maintenance mode + advisory + vulnerable transitive `uuid` | Migrated to modular v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) |
| `uuid` | Buffer-bounds advisory, patched in `11.1.1` | Bumped to **exactly** `^11.1.1` — not Dependabot's 3-major jump to 14.x (churn ≠ security) |
| `vite`/`esbuild` | esbuild dev-server CVE (any website could hit the dev server) | Vite 6.x — the *minimum* line with patched esbuild (5.x never got it). **Verified it boots + renders** before committing |
| `multer` 1.x | CVEs in 1.x line | Bumped to 2.x (zero-risk: nothing imports it yet) |

Also closed the redundant/conflicting bot PRs with a comment pointing at our PR.

### Challenges
- **A later stray `vite@^8.1.4` edit broke `npm install`** — `@vitejs/plugin-react@4.7`'s
  peer range stops at Vite 7. Reverted to the verified 6.4.3 combo. **Lesson:** "latest"
  isn't a goal; *patched + compatible + verified* is.
- **GitHub alert counts lag local `npm audit`** (different databases + scan cadence).
  Treat local `npm audit` + the repo Security tab as two views, not a contradiction.

### Interview Q&A
- *How do you evaluate a vulnerability?* Is the vulnerable path actually reachable in
  our code? (e.g., dev-server-only CVE ≠ production risk). What's the minimal patched
  version? Is anything importing it yet? Then bump precisely and verify.

---

## 6. Feature: User Model & Password Hashing

### The Feature
A MongoDB `User` schema — the single source of truth for identity; everything auth
builds on it.

### Ways to Implement Password Storage
1. Plaintext — never.
2. Fast hash (MD5/SHA-256) — cracked at billions/sec on GPUs; wrong tool (they're *designed* fast).
3. **bcrypt (chosen)** — deliberately slow, per-password salt built in, tunable cost factor.
4. argon2 — the newest standard, great choice too; bcrypt chosen for ubiquity + zero native-build friction on Windows.

### What We Did (`backend/src/models/User.js`)
- Fields: `name`, `email` (unique, lowercased), `password`, `googleId`, `avatarUrl`,
  `role` (`user`/`admin`), `emailVerified`, timestamps.
- **`password: { select: false }`** — default queries never return the hash; must
  explicitly `.select("+password")` at login. Defense-in-depth: even a careless
  `res.json(user)` elsewhere can't leak it.
- **`googleId: { unique: true, sparse: true }`** — sparse lets many docs *omit* the
  field without violating uniqueness (a plain unique index treats multiple missing
  values as duplicates). Needed because users are either password-based or Google-based.
- **Hashing in a `pre("save")` hook** with `isModified("password")` guard — *any* code
  path that saves a user gets hashing automatically; nobody can forget to call it.
  Cost factor **12** (~250ms) — slow enough to hurt brute force, fast enough for UX.
- **`comparePassword` instance method** — bcrypt is encapsulated in the model;
  controllers never touch it directly.

### Interview Q&A
- *Why is bcrypt slow on purpose?* The attacker's cost scales with yours. At cost 12,
  a leaked-hash brute force does one guess per ~250ms per core instead of billions/sec.
- *What's a salt and where is it?* Random per-password value stored *inside* the bcrypt
  string (`$2a$12$<salt><hash>`); kills rainbow tables and makes equal passwords hash differently.
- *Password never required at schema level — why?* Google-OAuth users have no password;
  validators enforce it only on the register path.

---

## 7. Feature: JWT Authentication (Register & Login)

### The Feature
Email/password signup and login issuing **JWT access + refresh tokens**.

### Ways to Implement Sessions
1. **Server-side sessions** (cookie = session id, state in Redis) — revocation is easy,
   but every request hits the session store, and horizontal scaling needs shared state.
2. **Pure stateless JWT** — no lookups, scales trivially; but *cannot revoke* before expiry.
3. **Hybrid (chosen):** short-lived stateless **access token** (15m) + long-lived
   **refresh token** (7d) tracked server-side in Redis. Stateless speed for 99% of
   requests, revocability where it matters.

### What We Did
- `utils/token.js` — sign/verify helpers; payload kept minimal (`sub` = user id, `role`).
  JWT payloads are base64, **readable by anyone** — never put secrets in them.
- **Token delivery split (the important design decision):**
  - *Access token* → JSON response body; frontend keeps it in memory (not localStorage).
  - *Refresh token* → **httpOnly cookie** (`SameSite=Lax`, `Secure` in prod) — page JS
    cannot read it, so XSS can't exfiltrate it. CSRF risk is bounded because `Lax`
    blocks cross-site POSTs, and the refresh endpoint only *returns a new token*, it
    doesn't perform state-changing business actions.
- **Reusable Joi `validate(schema)` middleware** — validates + strips unknown fields
  before controllers run; same helper will serve rooms/users/everything later.
- Register: 409 on duplicate email; password policy (min 8, upper+lower+digit) enforced
  at the *edge*, not the model (Google users bypass it legitimately).
- Login: `.select("+password")` (see §6) → `comparePassword` → same tokens.
- **Anti-enumeration:** wrong password and unknown email return the *identical*
  `401 "Invalid email or password"` — otherwise login becomes an oracle that reveals
  which emails have accounts.
- Stricter rate limit (20/15min) on all auth endpoints.

### Interview Q&A
- *Why not store the access token in localStorage?* localStorage is readable by any JS
  on the page → one XSS = stolen token. In-memory + httpOnly-cookie refresh is the
  standard hardened SPA pattern.
- *What are the three parts of a JWT?* `header.payload.signature` — signature =
  HMAC(header+payload, server secret). Readable by all, forgeable by none (without the secret).
- *Why 15 minutes for access tokens?* Bounds the damage window of a leaked token to 15
  minutes without forcing re-login (refresh flow renews silently).

---

## 8. Feature: Auth Middleware & Protected Routes

### The Feature
`authenticate` middleware: turns "has a valid access token" into `req.user` for any
route that opts in; first consumer is `GET /api/users/me`.

### What We Did (`middleware/authenticate.js`)
- Parse `Authorization: Bearer <token>` → `verifyAccessToken` → attach
  `req.user = { id, role }` → `next()`.
- Failure modes handled distinctly but *reported identically* (`401`):
  missing header / malformed header / bad signature / expired. The client's remedy is
  the same in every case ("refresh or log in again"), and detailed errors only help attackers.
- Route opts in per-route: `router.get("/me", authenticate, getMe)` — explicit, greppable.

### Verification (all live, real stack)
No header → 401 · `NotBearer x` → 401 · garbage token → 401 · **expired token
(signed with negative TTL to manufacture one)** → 401 · valid token → 200 + user JSON.

### Interview Q&A
- *Middleware vs decorator/guard?* Express composes handlers left-to-right per route —
  `authenticate` is just a handler that either calls `next()` or short-circuits with 401.
- *How would role-based access work?* A tiny `requireRole("admin")` middleware reading
  `req.user.role` after `authenticate` — the hook is already in place.

---

## 9. Feature: Refresh Token Rotation & Logout (Redis)

### The Feature
Make the 7-day refresh token **revocable** (logout that actually works) and
**single-use** (a stolen token, once rotated, is dead — and reuse is detectable).

### Ways to Implement Revocation
1. Blacklist revoked tokens until natural expiry — unbounded growth, only helps *after* you know it's stolen.
2. **Allowlist of currently-valid token IDs (chosen):** only tokens whose `jti` exists
   in Redis are honored. Logout = delete key. Rotation = delete old, insert new.
3. Short refresh TTL + forced re-login — simplest, worst UX.

### What We Did
- `generateRefreshToken` now embeds a **`jti`** (unique id, `crypto.randomUUID()`) and
  returns `{ token, jti }`.
- `services/refreshToken.service.js` — Redis `SET refresh:<jti> = userId EX <ttl>`;
  TTL derived from the *same* `JWT_REFRESH_EXPIRES_IN` env value (parsed with `ms`) so
  cookie, JWT, and Redis expiry can never drift apart. Redis TTL = automatic cleanup,
  no cron needed.
- `POST /refresh`: verify JWT signature → **check `jti` still in Redis and owned by the
  same user** → *delete it* (single-use) → issue brand-new pair via the shared
  `issueTokens()` helper (register/login/refresh all issue identically).
- `POST /logout`: revoke `jti`, clear cookie; succeeds even with an already-dead token
  (idempotent — the end state is what matters).
- Promoted `ms` from transitive to **direct** dependency (importing a transitive dep is
  fragile — it can vanish on any upstream update).

### The Security Property (the interview gold)
Rotation gives **theft detection**: if an attacker steals the refresh cookie and the
legitimate user refreshes first, the stolen token's `jti` is gone → attacker gets 401.
We *proved* this live: copied the cookie jar ("theft"), rotated legitimately, replayed
the stolen cookie → `401`.

### Verification (live, real Redis)
Login stores `refresh:<jti>` · refresh returns new token **and** swaps the Redis key ·
stolen pre-rotation cookie → 401 · logout empties Redis + expires cookie · refresh
after logout → 401.

### Interview Q&A
- *Why not blacklist?* Allowlist bounds memory to active sessions, TTL cleans up free,
  and it's fail-closed: Redis miss = rejected.
- *What's `jti`?* Standard JWT claim = token's unique ID; lets us track/revoke a
  *specific* token without storing the token itself.
- *Full reuse-detection story?* On reuse-after-rotation you can go further and revoke
  *all* the user's sessions (we noted this as a future hardening).

---

## 10. Feature: Google OAuth 2.0

### The Feature
"Sign in with Google" — user proves identity via Google; we never see their password.

### How the Authorization Code Flow Works (know this cold)
1. `GET /api/auth/google` → 302 to `accounts.google.com` with our **client_id**, scopes, callback URL
2. User consents on Google's page
3. Google 302s back to our **callback** with a one-time **authorization code**
4. Backend exchanges code + **client_secret** (server-side only) for the profile
5. We find-or-create the user, then issue **our own JWTs** — Google is only the
   identity check; session management stays entirely ours

### What We Did
- `config/passport.js` — `passport-google-oauth20` strategy, `session: false`
  (no server sessions; our JWTs take over after the one callback request).
- **Find-or-create with account linking:**
  1. Match by `googleId` → returning Google user
  2. Else match by `email` → existing password account: **link** it (set `googleId`,
     mark `emailVerified: true`) rather than create a duplicate. Safe *because* Google
     verified the email before redirecting back.
  3. Else create new user (`emailVerified: true` — Google-verified by definition).
- **Graceful degradation:** if creds are missing from env, the strategy isn't
  registered, boot logs a warning, and `/google` returns a clear **501** instead of
  passport's opaque "Unknown strategy" crash. Dev stays bootable without creds.
- **Token hand-off to the SPA (design decision):** the callback is a full-page
  redirect, not fetch — a token in the redirect URL would leak into browser
  history/logs. Instead: set the httpOnly refresh cookie → redirect to
  `CLIENT_URL/auth/callback` → SPA calls `/refresh` for its access token.
  (Reused the rotation infrastructure from §9 — building blocks paying off.)
- Google Cloud setup: OAuth consent screen (External, Testing mode + test users),
  Web-application credential, JS origin `http://localhost:3000`, redirect URI
  `http://localhost:5000/api/auth/google/callback` (must match env **exactly**).

### Challenges
- Redirect-URI mismatch is the classic failure — Google matches character-for-character
  (scheme, port, no trailing slash).
- Placeholder `change_me` JWT secrets replaced with 96-char random hex
  (`crypto.randomBytes(48)`) while we were in the env file — invalidated existing dev
  tokens, which is exactly what rotating a signing secret should do.
- Client secret was pasted in chat during setup → noted to rotate it in the console
  before any real deployment (Testing-mode dev credential, so low risk).

### Verification
- Without creds: boot warning + `/google` → 501 + password login unaffected.
- With creds: `/google` → 302 to `accounts.google.com` with correct `response_type=code`,
  `redirect_uri`, `scope`, `client_id` (inspected the Location header).
- **Full browser round-trip completed and verified in MongoDB/Redis:** signed in with a
  real Google account → landed on `localhost:3000/auth/callback` with "connection
  refused" (**expected** — the frontend doesn't exist yet; all the actual auth work
  happens server-side *before* that final redirect, so a dead redirect target doesn't
  mean the login failed). Confirmed directly in the database:
  ```json
  {
    "name": "Prakhar dhyani",
    "email": "prakhardhyani2000@gmail.com",
    "googleId": "108492590838903213128",
    "avatarUrl": "https://lh3.googleusercontent.com/...",
    "emailVerified": true,
    "role": "user"
  }
  ```
  Real profile data pulled correctly, `emailVerified` auto-true (Google already verified
  it), default role applied. A fresh `refresh:<jti>` key also appeared in Redis,
  confirming `issueTokens()` ran and the session cookie was set before the redirect.

### Interview Q&A
- *Why is the client secret safe but a token-in-URL isn't?* Secret lives server-side in
  env, never in the browser; URLs persist in history, logs, and Referer headers.
- *OAuth vs OIDC?* OAuth 2.0 = authorization framework; OpenID Connect = identity layer
  on top. passport-google-oauth20 fetches the profile for us, which covers the same need here.
- *Why issue your own JWTs instead of using Google's tokens?* Uniform session handling —
  one auth middleware, one refresh/rotation/logout path for both login methods.

---

## 11. Testing / Verification Methodology

We don't have automated tests yet (planned: Jest + supertest). Until then, every
feature is verified **end-to-end against the real running stack** — real MongoDB,
real Redis, real HTTP — never assumed from reading code:

- **curl with `-i`** to assert status codes, headers (Set-Cookie flags), and bodies.
- **Negative paths always tested** alongside happy paths: duplicate email, weak
  password, missing fields, wrong password, nonexistent user, missing/malformed/
  garbage/expired tokens, replayed rotated tokens, refresh-after-logout.
- **Manufactured edge inputs:** e.g. signed a JWT with negative TTL (`expiresIn: -10s`)
  to test expiry handling without waiting 15 minutes.
- **State verified at the source, not the API:** checked the bcrypt hash *in MongoDB*
  (`docker exec cs_mongo mongosh …`), watched refresh `jti` keys appear/rotate/vanish
  *in Redis* (`redis-cli --scan`).
- **Cookie-jar flows:** `curl -c/-b` to persist cookies across register → refresh →
  replay → logout sequences, including a simulated cookie theft.

**Recurring dev annoyances worth remembering:**
- Stale `node` processes holding port 5000 (`EADDRINUSE`) → find with
  `netstat -ano | findstr :5000`, kill by PID. Multiple background nodemons once piled
  up "waiting for file changes" and all woke at once — kill them all, start one.
- nodemon watches `.js`, **not `.env`** — env changes need a manual restart.
- kafkajs prints a benign `TimeoutNegativeWarning` on connect (internal timer quirk);
  harmless, ignored deliberately.

---

## Current Status / Next Steps

**Done (feature/auth branch):** User model · register · login · auth middleware ·
`/users/me` · refresh rotation · logout · Google OAuth — **fully verified end-to-end**,
including a real browser round-trip confirmed in MongoDB + Redis.

**Next:**
1. Decide: email verification + password reset now, or PR what we have and follow up
2. PR `feature/auth` → `develop`
3. Then: user profiles (avatar upload → S3-compatible storage, via **MinIO** — free,
   self-hosted, same `@aws-sdk/client-s3` API we already use) → rooms → mediasoup video core

## Note: No Paid Cloud Services

The user has no paid cloud accounts (no AWS, etc.) — every feature that would normally
reach for a paid service defaults to a free-tier or self-hosted alternative instead:

| Need | Paid default | Free choice for this project |
|---|---|---|
| File storage (recordings, snapshots, avatars) | AWS S3 | **MinIO** (self-hosted, S3-compatible, drops into docker-compose, zero code changes vs. `@aws-sdk/client-s3`) |
| MongoDB (once deployed) | Managed Atlas paid tier | Atlas **free tier** (M0, 512MB) |
| Redis (once deployed) | Managed Redis paid tier | **Upstash Redis** free tier |
| Kafka (once deployed) | Managed Kafka | **Upstash Kafka** free tier, or self-host |
| Email (verification/reset) | SendGrid/SES paid | **Resend** / **Brevo** free tier (300/day) |
| TURN server (WebRTC NAT traversal) | Twilio TURN | Self-hosted **coturn**, or Metered.ca free tier |
| Deployment | AWS/paid k8s | **Render** / **Railway** / **Fly.io** free tiers, or Oracle/GCP always-free VMs |
| Monitoring | Paid APM | **Grafana Cloud** free tier |

*Last updated: 2026-07-16*
