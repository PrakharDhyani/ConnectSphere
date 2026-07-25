# ConnectSphere — Development Notes & Interview Prep

> A running journal of every feature: what it is, the implementation options we weighed,
> what we actually built, the challenges we hit, and how we verified it works.
> Written so that any section can be explained confidently in an interview.
>
> **Convention:** each feature section follows the same shape —
> **The Feature → Ways to Implement → What We Did → Challenges → Interview Q&A**.

---

## 📚 Detailed Notes (file-by-file, local companion docs)

This journal stays the **interview-prep** view (decisions, trade-offs, Q&A).
The **detailed walkthroughs** — every file explained from `index.js` to the test
suite — live in three parts under `docs/notes/`:

| Part | Covers |
|---|---|
| [Part 0 — Technologies](notes/part-0-technologies.md) | **Start here.** Every single technology explained from zero — no assumed knowledge: HTTP/JSON/ports, Node, Express, MongoDB, **Redis**, **Kafka**, **ZooKeeper**, Docker, JWT, bcrypt, OAuth, React, Vite, Jest… what each is, why we use it, where it lives |
| [Feature Map](notes/feature-map.md) | Every feature in one fixed template: **tool & technology → what needs to be done → how it's done → workflow → file by file** |
| [Part 1 — Foundations](notes/part-1-foundations.md) | Everything common to backend & frontend: Docker Compose, git/GitHub workflow, `.env`, how FE↔BE talk (Vite proxy, CORS, cookies), shared tooling, ports |
| [Part 2 — Backend, file by file](notes/part-2-backend-auth.md) | The whole backend in request-pipeline order: `index.js`, `app.js`, `config/`, `utils/`, `middleware/`, `models/`, `validators/`, `services/`, `controllers/`, `routes/`, `sockets/`, and the entire `tests/` folder |
| [Part 3 — Frontend](notes/part-3-frontend.md) | The React scaffold file by file + the Auth UI feature; grows with every feature |

**Workflow from here:** every feature is built **full-stack** — backend + frontend
together on one `feature/*` branch — and documented in both this journal (the
"why") and the parts above (the "how, line by line").

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
11. [Feature: Email Verification & Password Reset](#11-feature-email-verification--password-reset)
12. [Testing / Verification Methodology](#12-testing--verification-methodology)
13. [Feature: Automated Test Harness (Jest + supertest)](#13-feature-automated-test-harness-jest--supertest)
14. [Feature: Auth UI — the frontend half of auth](#14-feature-auth-ui--the-frontend-half-of-auth)
15. [Feature: User Profiles — name edit & avatar upload (MinIO)](#15-feature-user-profiles--name-edit--avatar-upload-minio)
16. [Feature: Rooms — create, list, join by code](#16-feature-rooms--create-list-join-by-code)
17. [Feature: Real-time Chat in Rooms (Socket.io)](#17-feature-real-time-chat-in-rooms-socketio)
18. [Feature: Room Polish — member list, rename, leave, delete](#18-feature-room-polish--member-list-rename-leave-delete)
19. [Feature: Video Calls — mediasoup WebRTC SFU](#19-feature-video-calls--mediasoup-webrtc-sfu)
20. [Feature: Landing Page & Guest Access (join via link)](#20-feature-landing-page--guest-access-join-via-link)

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

## 11. Feature: Email Verification & Password Reset

### The Feature
Confirm users own their email (verification link on signup + resend), and let them
recover access via a "forgot password" email flow.

### Ways to Implement the Tokens
1. **Signed JWT as the token** — stateless, but can't be revoked/single-used without
   extra tracking, and a leaked signing secret forges valid links.
2. **Random token stored raw** (DB/Redis) — simple, but a store leak hands over live tokens.
3. **Random token, store only its hash (chosen)** — high-entropy random token emailed to
   the user; only its SHA-256 hash is stored. A store leak exposes nothing usable.

### What We Did
- `services/authToken.service.js` — `crypto.randomBytes(32)` token; store
  `SHA-256(token)` in Redis as `verify_email:<hash>` (24h TTL) / `reset_password:<hash>`
  (1h TTL), value = userId. **SHA-256 (fast hash) is correct here** — the token is
  already 256 bits of randomness, so there's nothing to brute-force (unlike a password,
  which needs slow bcrypt).
- **Single-use via `GETDEL`** — look-up-and-delete is atomic, so a token can't be
  replayed or race-used. Verified: reusing a consumed verify link → `?status=invalid`.
- `services/email.service.js` — one nodemailer transport configured entirely from env.
  Dev → **MailDev** container (SMTP :1025, web UI :1080) which *catches* mail and never
  delivers, so nothing leaves the machine and no paid service is needed. Prod → point
  `SMTP_*` at Resend/Brevo, **zero code change**.
- **Verification:** on register, `dispatchVerificationEmail` sends
  `SERVER_URL/api/auth/verify-email?token=…`. That endpoint is a `GET` (it's a link
  click), consumes the token, sets `emailVerified: true`, and redirects to the frontend
  with a status. Email sending is **best-effort** — wrapped in try/catch so a mail hiccup
  never fails the registration itself (user can `/resend-verification`).
- **Password reset:** `POST /forgot-password` → `POST /reset-password`. The reset link
  points at the frontend (`CLIENT_URL/reset-password?token=…`) since it needs a form; the
  actual change is the POST.
- **Anti-enumeration** on both `/forgot-password` and `/resend-verification` — always the
  same generic 200 ("if an account exists…"), regardless of whether the email is
  registered or already verified. Same principle as the login 401.
- **Reset kills all sessions.** Extended `refreshToken.service.js` with a per-user
  reverse index (`user_sessions:<userId>` Redis set of jtis) so `revokeAllUserSessions()`
  can drop every refresh token at once. On reset we also set `emailVerified: true`
  (clicking the emailed link proves ownership).

### Challenges / Design Notes
- **Set-membership TTL:** Redis sets have no per-member expiry, so the `user_sessions`
  set could accumulate stale jtis after their `refresh:` keys expire. Mitigated by giving
  the set the same TTL (refreshed on each new token) and making revoke tolerant of stale
  entries (deleting a missing key is a no-op).
- **Why the verify link hits the backend but the reset link hits the frontend:**
  verification is a one-click GET with no user input → backend can handle + redirect.
  Reset needs the user to type a new password → must land on a frontend form first.
- **Email as best-effort vs blocking:** chose non-blocking for registration (better UX,
  resend exists) but the reset/verify *tokens* are always created first so the flow is
  never left in a half state.

### Verification (live, real stack — MailDev + Redis + Mongo)
Register → verification email captured in MailDev → extracted the link → GET verified it
(`302 …?status=success`) → confirmed `emailVerified: true` in Mongo → **reused the token
→ `?status=invalid`** (single-use holds). Forgot-password → identical generic 200 for
both a real and a nonexistent email → reset email captured → reset-password `200` →
**`user_sessions` set gone + both of the user's refresh tokens revoked** → old refresh
cookie `401`, old password `401`, new password `200`.

### Interview Q&A
- *Why hash the token if it's not a password?* Defense-in-depth: a Redis dump shouldn't
  contain usable tokens. Fast hash is fine because the token is already high-entropy —
  the bcrypt "make it slow" logic only matters for low-entropy secrets (passwords).
- *Why does password reset revoke sessions but a normal password change might not?* Reset
  is the "I may be compromised / locked out" path — you must assume existing sessions are
  hostile and kill them. That's what the reverse index enables.
- *How do you stop the reset flow from leaking which emails are registered?* Identical
  response + timing-insensitive handling; the email either goes out or doesn't, but the
  API says the same thing either way.
- *Dev email without a paid provider?* MailDev (or MailHog) — a local SMTP sink with a web
  UI; swap env vars for a real provider in prod.

## 12. Testing / Verification Methodology

> **Update:** automated tests now exist — see §13. This section documents the
> **manual** end-to-end methodology used while building each feature (and still
> the way OAuth / the browser round-trip get verified). The two are complementary:
> the Jest suite guards the logic on every change; manual E2E proves the real
> infra wiring.

Until the harness landed, every feature was verified **end-to-end against the real
running stack** — real MongoDB, real Redis, real HTTP — never assumed from reading code:

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

## 13. Feature: Automated Test Harness (Jest + supertest)

### The Feature
A fast, dependency-free API test suite that drives the **real Express app** through
HTTP and asserts on status codes, bodies, cookies, and persisted state — so every
future change re-verifies the whole auth surface in ~15s instead of by hand.
**37 tests across 5 suites, all green.**

### Ways to Implement
1. **Hit a real running stack in CI** (spin up Mongo + Redis containers, boot the
   server) — highest fidelity, but slow, flaky, and needs Docker on every CI box.
2. **Mock everything, unit-test controllers in isolation** — fast, but tests the
   mocks more than the app; misses routing, middleware order, validation, cookies.
3. **Integration tests against the exported app, external edges faked (chosen)** —
   `supertest` drives the actual `app` (real routes/middleware/controllers/models),
   with only the *edges* replaced: in-memory Mongo, an in-memory Redis fake, and
   spied-out email/logger. Real behaviour, zero infra, runs anywhere.

### What We Did
- **`supertest` on the exported `app`** — the `app.js`/`index.js` split (§3) pays off:
  we import `app` without ever calling `listen()`, Kafka, or Socket.io.
- **MongoDB → `mongodb-memory-server`** — a real `mongod` spun up in-memory per suite.
  Real queries, real indexes (`unique(email)`, `sparse(googleId)` via `syncIndexes()`),
  no Docker. Fits the free/self-hosted constraint (no Atlas needed for tests).
- **Redis → a hand-written in-memory fake** (`tests/helpers/fakeRedis.js`)
  implementing *exactly* the command surface the services touch
  (`set {EX}`, `get`, `getDel`, `sAdd`, `sRem`, `sMembers`, `expire`, `del`). No
  `redis-server`, no second binary. TTLs accepted-but-not-enforced (nothing asserts
  wall-clock eviction; token expiry is tested via JWT `expiresIn`).
- **Email → spies that *capture* the URL** — instead of sending, the mocked
  `sendVerificationEmail` / `sendPasswordResetEmail` push `{to, url}` into an array,
  so a test pulls the real one-time token straight out of the link. This is the
  MailDev workflow (§11) reduced to an in-process array.
- **Logger → silenced mock** — no winston file handles leaking into the test process
  (which otherwise trips Jest's "open handle / did not exit" warnings).
- **Shared harness** (`tests/helpers/harness.js`) wires all of the above and does
  per-test cleanup (`deleteMany` on every collection — keeping indexes — + flush the
  Redis fake + clear captured emails), so tests are independent and order-agnostic.
- **Coverage where it matters:** controllers ~90%, `token`/`authToken`/`refreshToken`
  services & validators & auth middleware 100%. The uncovered files are the mocked
  edges and the Google-OAuth / browser path — deliberately proven live in §10, not here.

### Challenges (the real ones)
1. **ESM + Jest.** The project is `"type": "module"`; Jest's mocking predates native
   ESM. Fixes: run under `node --experimental-vm-modules node_modules/jest/bin/jest.js`
   (works on Windows *and* CI — no `cross-env` needed, unlike inline `NODE_OPTIONS=`),
   `transform: {}` to disable Babel, and `jest.unstable_mockModule(...)` + dynamic
   `await import()` instead of the hoisted `jest.mock()`.
2. **Mock path resolution.** `jest.unstable_mockModule("../../src/config/redis.js")`
   failed with *"Cannot find module … from tests/xyz.test.js"* — the specifier is
   resolved relative to the **entry test file**, not the `harness.js` that calls it.
   Since test files sit at a different depth than the helper, the relative path was
   wrong. Fix: compute an **absolute** path to `src/` from `import.meta.url` and pass
   that — it resolves to the same module id regardless of which test file calls in.
3. **Rate limiter vs. the test client.** The in-process `express-rate-limit` counts
   every request from the same loopback IP, so a suite firing >20 auth requests would
   start getting spurious `429`s. Fix: `skip: () => process.env.NODE_ENV === "test"`
   on both limiters — a one-line, clearly-scoped source change (the limiter is still
   fully wired in dev/prod).
4. **Env read at import time.** `token.js` computes `REFRESH_TOKEN_TTL_SECONDS` and
   the JWT secrets are read when modules load — so the harness sets `process.env`
   at its own module top level, *before* the dynamic `import()` of `app.js`.

### What the Suite Actually Asserts (mirrors the manual E2E of §7–§11)
Register (happy / dup 409 / weak-pw 400 / bad-email 400 / verification email sent) ·
login (happy / wrong-pw 401 / unknown-email identical 401 / validation) ·
refresh **rotation** (new cookie ≠ old) + **theft detection** (replayed pre-rotation
cookie → 401) · logout (cookie cleared + token revoked, idempotent) · email verify
(link works, **reuse → invalid**, bad/missing token) · resend & forgot-password
(generic 200, no enumeration oracle) · reset (new pw works / old fails / **all
sessions revoked** / invalid token 400 / weak pw 400) · `/users/me`
(valid 200 / no header / malformed / garbage / wrong-secret / **expired** / deleted-user 404) ·
health + 404 envelope + Google 501.

### Interview Q&A
- *Why fake Redis by hand instead of `redis-mock`?* We use `node-redis` v4 (promise
  API, `getDel`, `sAdd`…); most mocks target `ioredis`. The service layer only touches
  ~8 commands, so a 40-line fake is less risk than a mismatched library — and it keeps
  `npm test` with **zero external processes**.
- *Integration vs unit tests — why lean integration here?* The bugs that actually bite
  auth live in the *wiring*: middleware order, cookie flags, validation, the
  rotate-then-revoke sequence. Driving the real `app` catches those; isolated unit
  tests of a controller would mock exactly the parts most likely to be wrong.
- *How do you test a one-time email token without email?* Capture the link the code
  would have sent (spy records the URL), parse the token out, and use it — same token
  the user would click, no SMTP involved.
- *Why disable rate limiting in tests rather than test it?* The limit is config, not
  logic; testing "20 then 429" is inherently timing/IP-coupled and flaky. We assert the
  *behaviours* the limiter protects and keep the limiter live in real environments.
- *Is 79% total coverage low?* The denominator includes infra we mock on purpose
  (redis/email transports) and the OAuth/browser path proven live in §10. The
  **logic** surface — controllers, services, validators, auth middleware — is 90–100%.

---

## 14. Feature: Auth UI — the frontend half of auth

*(Full template entry: [feature-map F10](notes/feature-map.md) · deep dive: [Part 3](notes/part-3-frontend.md))*

### The Feature
React pages + plumbing for everything the auth backend already does: login,
register, Google button, forgot/reset password, email-verified landing page, a
protected dashboard — and sessions that survive page reloads.

### Ways to Implement (where does the token live?)
1. localStorage — survives reloads but readable by any XSS. Rejected.
2. Plain cookie for everything — CSRF surface widens. Rejected.
3. **(chosen)** Access token in memory (zustand) + refresh token in the
   httpOnly cookie the backend already sets; reloads restored by one silent
   `/refresh` call at boot.

### What We Did
- `stores/auth.store.js` — zustand store with **three** states
  (`loading/authed/guest`); `loading` exists so protected pages spinner during
  boot instead of flashing the login page at logged-in users.
- `lib/api.js` — one axios instance: request interceptor attaches the Bearer
  token; response interceptor catches 401s, silently refreshes (**single-flight**
  — rotation makes refresh single-use, so parallel 401s must share one refresh)
  and retries; `bootstrapAuth()` restores the session at app start.
- react-hook-form + zod on every form; zod schemas mirror the backend Joi rules
  (instant field errors; server still enforces).
- Pages: Login (+ reset-success/oauth-error messages), Register, AuthCallback
  (post-Google), EmailVerified, Forgot/ResetPassword, Dashboard (verify-email
  banner + resend, logout).
- Google = `<a href="/api/auth/google">` — OAuth is a redirect dance, cannot be fetch.

### Challenges
- **The scaffold had never been run:** `NotFoundPage.jsx` was an empty file
  imported by `App.jsx` — instant crash on first real run. Fixed.
- JSX lint trap: raw `'` in text fails `react/no-unescaped-entities` in CI.

### Verification
`npm run lint` + `npm run build` clean. Live browser round-trip against the
full stack queued for next session (needs Docker up).

### Interview Q&A
- *Why not localStorage for tokens?* Any XSS reads localStorage; memory +
  httpOnly cookie is the hardened-SPA standard.
- *How does a reload keep you logged in if the token is in memory?* It doesn't —
  the httpOnly cookie does. Boot calls `/refresh`; cookie valid → new access
  token, session restored.
- *Why single-flight refresh?* Refresh tokens are single-use (rotation). Two
  parallel refreshes = the second kills the session the first just created.

---

## 15. Feature: User Profiles — name edit & avatar upload (MinIO)

*(Full template entry: [feature-map F11](notes/feature-map.md))*

### The Feature
`PATCH /users/me` (display name) + `POST /users/me/avatar` (image upload to
S3-compatible storage) + a React profile page. First feature built **full-stack
in one branch**, and first use of object storage.

### Ways to Implement File Storage
1. Store images in MongoDB (base64/GridFS) — bloats the DB, no CDN path. Rejected.
2. Server's local disk — dies on redeploy, breaks with >1 server. Rejected.
3. **(chosen)** Object storage via the S3 API — but **MinIO** self-hosted in
   Docker instead of AWS (free-tier rule). Same SDK, env-var swap to real
   S3/R2 in prod.

### What We Did
- `services/storage.service.js` — S3 client (`forcePathStyle: true`, the one
  MinIO-specific flag), lazy auto-create bucket, deterministic key
  `avatars/<userId>.<ext>` (re-upload overwrites → zero orphan cleanup),
  `?v=<ts>` cache-buster. Same 501 graceful-degradation pattern as OAuth.
- multer in **memory** mode (buffer → straight to bucket, never disk), 2MB cap,
  JPEG/PNG/WebP only; a wrapper adds statusCode 400 to multer's own errors
  (they'd otherwise surface as 500s).
- `updateMeSchema`: partial update, `.min(1)`; stripUnknown kills smuggled
  `role: "admin"` — with a regression test proving the DB stays `user`.
- Frontend: FormData upload with hidden file input, avatar preview/initials
  fallback, dashboard header avatar → profile link.
- Test harness grew a storage mock capturing uploads (`h.uploads`) — 10 new
  tests, suite now **47 green**.

### Challenges
- multer errors (e.g. LIMIT_FILE_SIZE) carry no `statusCode` → our error
  handler would report 500 for a user mistake; fixed with the wrapper.
- Cache-busting: deterministic keys mean the URL never changes — browsers would
  show the old avatar forever without the version query.
- **AWS SDK v3 ↔ MinIO hang (found on first live run).** `PutObject` hung
  forever. Root cause: since ~Jan 2025 the SDK adds a default `crc32` integrity
  checksum sent with `aws-chunked` streaming framing, which MinIO stalls on.
  Fix: `requestChecksumCalculation/responseChecksumValidation: "WHEN_REQUIRED"`
  (pre-2025 behaviour; real S3 accepts it too) + request timeouts so storage
  can never hang a request. **Debugging lesson:** an isolated SDK probe
  succeeded while the app "hung" — the real red herring was Windows `curl.exe`
  failing to read a Git-Bash `/tmp/` path (never sent the request), which
  *looked* like a server hang. Always confirm the client actually sent the bytes.
- **Private-by-default buckets.** The upload succeeded but the avatar URL 403'd
  in the browser — MinIO buckets are private. Added a public-read bucket policy
  scoped to `avatars/*` only (nothing else exposed). Verified: anonymous GET → 200.

### Interview Q&A
- *Why memory storage for multer, not disk?* The file's destination is the
  bucket; a disk hop adds I/O, cleanup, and breaks on multi-instance deploys.
- *Why is a stable object key better than a random one per upload?* Overwrite
  semantics = no orphaned files, no GC job; version query handles caching.
- *How would this scale to recordings?* Same service, new prefix + presigned
  URLs (SDK already installed) so clients upload directly to storage.

---

## 16. Feature: Rooms — create, list, join by code

*(Full template entry: [feature-map F12](notes/feature-map.md))*

### The Feature
The container everything else attaches to: create a room → share a 6-char
invite code → others join → members open the room page. Full-stack: Room
model + 4 endpoints + rooms dashboard + room page.

### Ways to Implement Joining
1. Join by room ID — IDs are long, ugly, and leak enumeration surface. Rejected.
2. Invite links with signed tokens — heavier than needed pre-launch. Later.
3. **(chosen)** Short random code (6 hex chars, unique-indexed) — human-shareable
   ("a1b2c3"), unguessable by scanning (16.7M), O(1) lookup.

### What We Did
- `Room` model with a `pre("validate")` hook enforcing two invariants at the
  model level (nobody can forget them): code auto-generated, **owner is always
  a member**.
- Join = one atomic `findOneAndUpdate` + **`$addToSet`** — add-if-absent, so
  joining twice can't duplicate membership and there's no read-then-write race.
- Membership gate on `GET /rooms/:id`: member 200 / non-member **403** (room
  exists — the join flow is the door) / unknown-or-malformed id 404. The
  malformed-id case needs an explicit `isValidObjectId` guard — otherwise
  mongoose throws a CastError and the user sees a 500 for a typo.
- Create retries on the unique-index collision (E11000) with a fresh code —
  1-in-16M shouldn't fail a user's request.
- Frontend: dashboard is now the rooms hub — **first real TanStack Query
  usage**: `useQuery(["rooms"])` for the list, mutations for create/join that
  `invalidateQueries` so the list refetches itself. RoomPage: copy-invite-code
  button, distinct 403/404 screens, Phase-3 video placeholder.
- 9 new tests → suite **56 green**.

### Challenges
- Deciding 403 vs 404 for non-members: 404 would hide the room's existence
  (more private), but the UX needs "you're not in — go get the code," and codes
  (not ids) are the secret here. Documented trade-off.
- Case-insensitive codes: Joi `.lowercase()` normalizes, so a code read out
  loud as "A1B2C3" still joins.

### Interview Q&A
- *Why `$addToSet` over "read members, push, save"?* Atomic — two simultaneous
  joins can't race; and it's idempotent for free.
- *Why is the invite code its own unique index and not the `_id`?* IDs are
  permanent and enumerable; codes are short, shareable, and could later be
  rotated/expired without changing the room's identity.
- *Where does video attach?* The RoomPage placeholder — mediasoup signaling
  joins over Socket.io, keyed by this room id (Phase 3).

---

## 17. Feature: Real-time Chat in Rooms (Socket.io)

*(Full template entry: [feature-map F13](notes/feature-map.md) — Phase 3 begins here)*

### The Feature
Live chat inside a room: instant messages for everyone present, a "who's online"
presence list, typing indicator, and durable history that survives reload.
Members only. First real-time feature — sets the socket patterns video reuses.

### Ways to Implement Real-time
1. HTTP polling ("any new messages?" every 2s) — simple, but laggy and wasteful. Rejected.
2. Raw WebSocket — no reconnection/fallback/rooms; you rebuild all of it. Rejected.
3. **(chosen)** Socket.io — WebSocket + auto-reconnect + server-side "rooms" +
   polling fallback. Redis adapter is the documented path to multi-instance scale.

### What We Did
- **Socket auth via the handshake:** a socket has no per-message header, so the
  client sends its access token once at connect (`auth: { token }`); an
  `io.use()` middleware verifies the JWT and loads the user onto `socket.user`.
- **Rooms & presence:** each app room → a Socket.io room `room:<id>`; presence =
  distinct users among the sockets in it (de-duped, so multiple tabs = one
  person), recomputed and broadcast on join/leave/disconnect.
- **Server-authored messages:** `message:send` re-checks membership (never trust
  the client), persists to a new `Message` model, then broadcasts `message:new`
  to the whole room *including the sender* → everyone renders it once.
- **History over REST** (`GET /rooms/:id/messages`, membership-gated, keyset
  `?before=` pagination) — live delivery + durable backlog, the standard split.
- **Frontend:** a socket singleton (token via callback so reconnects use a fresh
  token), a `useRoomChat` hook (history + join + live subscriptions), and a chat
  UI (bubbles, presence sidebar, typing line, auto-scroll).

### Challenges
- **Presence on disconnect:** `disconnecting` fires while the socket still lists
  its rooms, so a naive recompute counts the leaver. Fixed by deferring the
  recompute one tick (`setImmediate`) until after it's actually gone.
- **Duplicate messages:** optimistic append + the server echo = each message
  twice. Fixed by *not* appending optimistically — render only the server's
  `message:new` echo (also gives the real id/timestamp).
- **Dev-server port churn (real ops lesson):** rapid file saves triggered
  overlapping nodemon restarts that fought over port 5000 (EADDRINUSE) and
  spawned zombie node processes. Fixed by killing the port holders and doing one
  clean start. Also: node-redis' reconnect strategy *gives up and closes* after
  N tries — if Redis blips during a restart, the client stays closed until the
  server restarts. Both are dev-only but worth knowing.

### Verification
Automated: 6 REST history tests (**suite 62 green**). Live: a 2-client Node
script against the running server proved bad-token rejection, join + presence
(2 online), Alice→Bob live delivery + ack, empty-message + non-member guards,
and persisted history — all passed.

### Interview Q&A
- *How do you authenticate a WebSocket?* Not per-message — verify the token in
  the connection handshake once, attach the user to the socket, trust it for the
  connection's life (reconnect re-runs it with a fresh token).
- *Why broadcast the sender's own message back instead of rendering locally?*
  One source of truth: the server assigns id/timestamp and everyone (sender
  included) renders the same echo → no duplicates, no divergence.
- *Why keep history in Mongo if Socket.io already delivers messages?* Sockets are
  ephemeral — a reload or late join has no backlog. Live = socket, history = DB.
- *How would presence/chat scale past one server?* The Socket.io Redis adapter
  pub/subs events across instances; Redis is already in the stack.

---

## 18. Feature: Room Polish — member list, rename, leave, delete

*(Full template entry: [feature-map F14](notes/feature-map.md))*

### The Feature
Round out rooms into something fully manageable: a real member roster (not just
who's online), owner rename + delete, and member leave — with connected members
gracefully bounced out when a room is deleted.

### What We Did
- `GET /rooms/:id` now populates members (`{id, name, avatarUrl, isOwner}`) and
  returns `isOwner` for the caller so the UI can gate owner-only actions. List
  endpoints stay lightweight — detail lives only on the single-room view.
- **Permission rules:** rename/delete are **owner-only** (403 otherwise); a
  member can **leave** but the **owner can't** (they'd orphan the room → 400,
  must delete). Leave is idempotent.
- **Delete cleans up:** removes the room *and* its messages (`deleteMany`), then
  broadcasts `room:closed` over the socket so members currently in the room get
  navigated back to the dashboard instead of staring at a dead page.
- **Broadcasting from REST:** the controller imports the socket `io` + the shared
  `roomKey` helper and emits `room:closed` / `room:updated` / `room:members-changed`.
  `io?.` guards the no-socket case (tests never call `initSocket`).
- Frontend: members sidebar (online dot + owner badge), inline rename, confirm
  dialogs for leave/delete, socket lifecycle listeners, and dashboard flash messages.

### Challenges
- **403 vs 404 for non-owner actions:** a member (or outsider) hitting
  rename/delete gets 403 "owner only" — the room exists, they just lack rights.
  Consistent with the read gate (§16).
- **Broadcasting from HTTP land:** the REST controller lives outside the socket
  layer, so it imports `io` (a live ESM binding, `undefined` until `initSocket`)
  and the `roomKey` prefix from the socket module — with a `?.` guard so the same
  code is safe in tests where no socket server exists.
- **Dev port churn (again):** the rapid edit→nodemon-restart cycle kept leaving a
  zombie node on :5000 (EADDRINUSE). Standard fix each time: stop the task, kill
  the port holder, one clean start. A production process manager (pm2) wouldn't
  have this; it's purely a dev-loop artifact.

### Verification
Automated: 10 new tests (**suite 72 green**). Live 2-client script: member-list
detail, owner rename ok + member rename 403, delete broadcasts `room:closed` to a
connected member + 404 after, member leave 200 + owner leave 400 — all passed.

### Interview Q&A
- *Why does the owner have to delete instead of leave?* Membership includes the
  owner; letting them leave would orphan a room nobody can administer. Leaving is
  for members; owners delete (or, future work, transfer ownership first).
- *How does a user sitting in a deleted room find out?* The delete handler
  broadcasts `room:closed` to the Socket.io room; every connected client's
  listener bounces them to the dashboard. No polling, no stale page.
- *Why populate members only on the detail endpoint, not the list?* The list can
  be long; populating every room's members on the dashboard is wasteful. Detail
  is one room, one populate — pay the cost only where the roster is shown.

---

## 19. Feature: Video Calls — mediasoup WebRTC SFU

*(Full template entry: [feature-map F15](notes/feature-map.md) — the headline feature)*

### The Feature
Live audio/video in a room: publish your camera/mic once, see/hear everyone
else, and people joining mid-call appear automatically. Built on the Socket.io
layer from §17.

### Ways to Implement Group Video
1. **P2P mesh** — every browser connects directly to every other. Dead simple
   for 2, but each person uploads N-1 copies → melts past ~3–4 people. Rejected.
2. **MCU** (server mixes everyone into one stream) — light on clients, but huge
   server CPU and no per-user layout control. Rejected.
3. **(chosen) SFU** — each browser uploads ONE stream to the server, which
   selectively forwards it to the others. Uploads stay constant regardless of
   room size; clients get individual streams. **mediasoup** is the SFU.

### What We Did
- **Server (mediasoup):** a `Worker` at boot; a `Router` per room (Opus/VP8);
  each peer gets a **send** + **recv** `WebRtcTransport`; `Producer`s (incoming
  tracks) and `Consumer`s (outgoing) tracked per-peer so leave/disconnect closes
  exactly them, and the router frees when the call empties.
- **Signaling over Socket.io** (not media!): `getRtpCapabilities`, create/connect
  transport, produce, getProducers, consume, resume, leave — all membership-gated.
  The audio/video itself flows over the transports' UDP.
- **Client (mediasoup-client):** a `useMediaRoom` hook loads a `Device`, does
  `getUserMedia`, produces mic+cam, consumes existing + newly-arriving producers,
  and toggles mic/camera. Imperative objects (device/transports/consumers) live in
  refs; only the streams are React state. A `VideoTile` renders each MediaStream.
- **Windows win:** mediasoup's native worker was the big risk (historically
  Linux/macOS/WSL only) — **it runs natively on Windows 11 here (3.21.0)**, so no
  Docker-for-backend or WSL needed.

### Challenges / Design Notes
- **Signaling vs media split** is the whole mental model: Socket.io only carries
  the *setup*; the tracks travel over WebRTC UDP transports.
- **Consume paused, then resume:** consumers start paused so no frames arrive
  before the `<video>` is wired up; the client resumes once ready.
- **`<video>` can't take a stream as a prop** — must set `el.srcObject`
  imperatively in an effect (VideoTile).
- **Cleanup is easy to leak:** closing a transport closes its producers/consumers,
  so leave/disconnect/unmount just close transports + stop local tracks.
- **Local tile muted + mirrored** — never play your own mic (echo), mirror for a
  natural selfie.

### Verification
mediasoup runs natively (probe). Server-side signaling script proved capabilities
+ send/recv transport creation + ICE candidates + membership gate. Lint + build
clean; 72 backend tests green. **The full A/V loop (produce↔consume) needs a real
browser + camera → manual 2-tab test** (open two browsers, same room, Join call).

### Interview Q&A
- *Why an SFU over a mesh?* Mesh upload cost is O(N) per person and collapses
  past a few users; an SFU keeps each client's upload at one stream.
- *Does the video go through Socket.io?* No — Socket.io only negotiates setup;
  media flows over the mediasoup WebRTC transports (UDP).
- *How does a late joiner see people already talking?* `media:getProducers`
  returns everyone currently producing; the joiner consumes each, and
  `media:newProducer` keeps them in sync afterward.
- *What's needed for production?* A Worker pool (~1/core), the Socket.io Redis
  adapter + sticky sessions for multi-instance, and a **TURN** server (coturn)
  for users behind strict NATs.

---

## 20. Feature: Landing Page & Guest Access (join via link)

*(Full template entry: [feature-map F16](notes/feature-map.md))*

### The Feature
Three connected changes: a real marketing **Home page** (not the login screen);
**copy a link, not a code**; and **guest access** — join a meeting from a link
with just a name, participate fully in the call, but no dashboard/profile/room
creation — with guests being ephemeral (leave no trace).

### Ways to Implement Guests
1. Add guests to `room.members` and delete later — pollutes the member list and
   leaves dangling refs when the ephemeral user is cleaned up. Rejected.
2. A fully separate guest auth system — duplicate token/socket logic. Rejected.
3. **(chosen)** A normal (but ephemeral) `User` with an `isGuest` flag + a
   **room-scoped token**: a `room` claim grants access to exactly one room
   without membership, and a Mongo **TTL index** auto-deletes the guest. Reuses
   all existing auth/socket plumbing.

### What We Did
- **Landing page** — hero, live-feature grid, how-it-works, "coming soon"
  roadmap (filters/whiteboard/games/recording), CTAs; auth-aware.
- **Copy link** — the room page copies `${origin}/join/${code}`; `/join/:code`
  auto-joins registered users and offers "join as guest" to everyone else.
- **Room-scoped guest token** — `generateGuestToken` embeds `{isGuest, room}`.
- **One shared access rule** — `utils/roomAccess.js` `canAccessRoom()` (member OR
  scoped guest), used by both socket handlers and both room/message controllers,
  replacing the duplicated `isMember`.
- **Guardrails** — `requireFullUser` → 403 for guests on create/list/join/rename/
  delete rooms + profile edits; `ProtectedRoute fullUserOnly` mirrors it in the UI.
- **Ephemeral cleanup** — `expiresAt` + a TTL index; guests never enter
  `room.members`, so nothing dangles when they're removed.

### Challenges / Design Notes
- **Email was required + unique.** Guests have none → made email optional +
  **sparse** (same trick as `googleId`), so many guests coexist; the register
  validator still enforces email for real signups.
- **Membership vs scoped access.** Guests aren't members, so the whole access
  check had to move to a shared helper that also honors the token's `room` claim
  — otherwise chat/video would reject them.
- **Guest scoping is a security boundary** — a guest token for room A must not
  touch room B. Enforced by comparing the token's `room` claim to the target
  room, and covered by a test.

### Verification
81 backend tests (9 new guest tests), incl. scoped-access and every blocked
action. Live script confirmed join → scoped read → 403 on create/list → bad
code. Lint + build clean.

### Interview Q&A
- *How do guests get into a room without being members?* Their JWT carries a
  `room` claim; the shared `canAccessRoom` check allows a scoped guest into
  exactly that room — no `room.members` entry, so nothing to clean up.
- *How are ephemeral guests cleaned up?* A Mongo TTL index on `expiresAt` deletes
  the guest user automatically; nothing references them elsewhere.
- *How do you stop a guest from wandering into other rooms or hosting?* The
  token is single-room scoped (tested), and `requireFullUser` returns 403 on all
  registered-only actions.
- *Why let email be null for guests but keep it unique?* A **sparse** unique
  index enforces uniqueness only on documents that have the field.

---

## Current Status / Next Steps

**Done — `feature/auth` (merged to develop, PR #7):** User model · register · login ·
auth middleware · `/users/me` · refresh rotation · logout · Google OAuth — fully verified
end-to-end including a real browser round-trip.

**Done — the whole auth surface (backend + frontend):** register/login · refresh
rotation · logout · Google OAuth · email verification · password reset · **Auth UI**
(§14: session restore across reloads, silent refresh, protected routes).

**Done — test harness (§13):** Jest + supertest, in-memory Mongo + Redis fake +
captured email/storage spies. **56 tests, 7 suites, all green**, no Docker needed.

**Done — User Profiles (§15):** name edit + avatar upload to MinIO, profile page.

**Done — Rooms (§16):** create / list / join-by-code + rooms dashboard + room page.

**Done — Real-time Chat (§17, Phase 3):** Socket.io live messaging + presence +
typing + durable history, verified live with 2 clients.

**Done — Room Polish (§18):** member list, owner rename/delete, member leave,
`room:closed` broadcast. **72 tests green.**

**Done — Video Calls (§19):** mediasoup SFU + WebRTC signaling + client video
grid + mic/cam controls. mediasoup runs natively on Windows; signaling verified
server-side. **Manual 2-tab A/V test is the one open verification.**

**Also done:** dependency hygiene — `npm audit fix` (backend prod vulns → 0) and
react-router upgraded v6 → v7.

**Done — Landing + Guest access (§20):** marketing home page, copy-link (not
code), and ephemeral guest join-via-link with room-scoped access. **81 tests green.**

**Branch state (stacked — merge PRs in this order):**
`feature/auth-extras` → `feature/auth-frontend` → `feature/user-profiles` →
`feature/rooms` → `feature/room-chat` → `feature/room-polish` → `feature/video`
→ `feature/landing-guest`, each based on the previous; merge into `develop` in
that order.

**Done — Screen share:** `getDisplayMedia` → a mediasoup producer tagged
camera/screen; screen tiles render large. Guest-join 500 (duplicate-null email)
fixed via a **partial** unique index + dev-only `syncIndexes` self-heal.

**Direction shift (2026-07-25):** repositioning to a **fun group-hangout
platform** (video is just the room; USP = group fun). Planned: mini-games
(ludo, skribbl, quiz), watch-party (**synced YouTube embeds** — not ad-stripping,
which violates ToS), Excalidraw whiteboard. Rename to a French name (TBD).
**Responsive (mobile/tablet/laptop) is now a hard requirement.**

**Next:**
1. **Manual browser tests** — video + screen share (2 tabs, webcam) + guest link.
2. **Responsive pass** on every page (mobile/tablet).
3. Then the fun features: whiteboard (Excalidraw), a mini-game (skribbl), watch-party.
4. Merge the branch chain into `develop`; later coturn (TURN) for real-network calls.

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

*Last updated: 2026-07-25 (landing page + guest access via invite link; copy-link not code)*
