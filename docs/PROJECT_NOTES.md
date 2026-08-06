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
The **detailed, from-zero walkthroughs** — every feature and file explained so
someone who knows only a little frontend/backend can follow — live under
`docs/notes/` (local only). Start with the [reading guide](notes/README.md).

| Part | Covers |
|---|---|
| [Part 0 — Technologies](notes/part-0-technologies.md) | **Start here.** Every technology from zero: HTTP/JSON/ports, Node, Express, MongoDB, **Redis**, **Kafka**, Docker, JWT, bcrypt, OAuth, React, Vite, WebSocket, WebRTC, Jest — what each is, why, where |
| [Part 1 — Foundations](notes/part-1-foundations.md) | Shared by both sides: Docker Compose, git workflow, `.env`, how FE↔BE talk (Vite proxy, CORS, cookies), ports |
| [Part 2 — Backend, file by file](notes/part-2-backend-auth.md) | The whole backend in request-pipeline order, auth as the worked example, + the test suite |
| [Part 3 — Frontend](notes/part-3-frontend.md) | The React scaffold + Auth UI (store, axios silent-refresh, protected routes) |
| [Part 4 — Rooms, Chat & Presence](notes/part-4-rooms-chat.md) | Rooms + real-time chat/presence/typing — the Socket.io foundation every activity reuses |
| [Part 5 — Video, Screen share & Voice](notes/part-5-video-media.md) | WebRTC via the mediasoup SFU; signaling vs media; screen share; the VoiceBar |
| [Part 6 — Landing + Guest Access](notes/part-6-guest-landing.md) | Marketing home page + ephemeral room-scoped guest access (TTL cleanup, partial-index fix) |
| [Part 7 — Whiteboard](notes/part-7-whiteboard.md) | Integrating Excalidraw + our live sync / cursors / persistence layer |
| [Part 8 — Mini-Games](notes/part-8-games.md) | Draw & Guess (ready-up lobby, scoring), Ludo (step-based board model), Games Hub, activity notifications |
| [Part 9 — Friends](notes/part-9-friends.md) | Friend requests/list, real-time invites to a room, the global notification system |
| [Feature Map](notes/feature-map.md) | Every feature (F1–F22) in one fixed template: **tool → what → how → workflow → file-by-file** |

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
21. [Feature: Collaborative Whiteboard (Excalidraw)](#21-feature-collaborative-whiteboard-excalidraw)
22. [Feature: Draw & Guess Game (Skribbl-style)](#22-feature-draw--guess-game-skribbl-style)
23. [Feature: Ludo — Board Game (2–4 players)](#23-feature-ludo--board-game-24-players)
24. [Feature: Friends — requests, list, invite to a room](#24-feature-friends--requests-list-invite-to-a-room)

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

## 21. Feature: Collaborative Whiteboard (Excalidraw)

*(Full template entry: [feature-map F18](notes/feature-map.md))*

### The Feature
An Excalidraw-grade whiteboard inside every room that the whole group edits
together in real time — infinite canvas, all tools, live cursors, persistence.

### Ways to Implement
1. **Build a canvas engine from scratch** (shapes, arrows, text, selection,
   undo, export, snapping…) — literally rebuilding Excalidraw. Months of work,
   strictly worse. Rejected.
2. **A lighter canvas lib** (fabric.js/tldraw-core) + custom tools — still huge.
3. **(chosen) Integrate the official Excalidraw React component** — it already
   ships ~the entire requested feature list; we add only the *group* layer
   (real-time sync + presence + persistence) over our Socket.io.

### What We Did
- **Reused Excalidraw** for the whole drawing surface (canvas, tools, arrows,
  text, images, frames, styling, alignment, layers, undo/redo, export, library,
  mobile/stylus, shortcuts). Lazy-loaded (~1.8 MB, code-split) so it only loads
  when the board is opened.
- **Group layer (ours):** `whiteboard.handlers.js` — membership-gated join that
  syncs the current scene, live `whiteboard:update` broadcasts, presence
  cursors, and **debounced Mongo persistence** (a `Whiteboard` doc per room) so
  boards survive restarts and late joiners get current state.
- **Reconciliation:** remote element sets merge by element **`version`**
  (last-write-wins per element) so concurrent edits converge without dropping
  local work; deletions ride Excalidraw's `isDeleted` + version bump.
- RoomPage gets a **Room / Whiteboard toggle**; the call keeps running hidden so
  audio continues while you draw.

### Challenges / Design Notes
- **Echo loops:** applying a remote scene fires Excalidraw's `onChange`, which
  would rebroadcast. Guarded with a `suppress` flag around `updateScene` + a
  throttle, plus version-based merge so it converges regardless.
- **Bundle size:** Excalidraw pulls katex/cytoscape/mermaid for diagram
  features → lazy-load + `Suspense` keeps it off the initial app load.
- **"OT/CRDT-friendly" wish-list item:** our socket-sync + version reconcile IS
  the ready architecture; swapping in a true CRDT (Yjs) later is a contained change.

### Verification
Live 2-socket script: join, update broadcast, non-member blocked, late-joiner
scene sync — all passed. 81 backend tests green; lint + build clean. Full
drawing UX is a manual browser test (2 tabs).

### Interview Q&A
- *Why integrate Excalidraw instead of building it?* The requested feature list
  IS Excalidraw's feature set; rebuilding it would take months and be worse. The
  value we add is the *collaboration* layer, which is platform-specific.
- *How do concurrent edits not clobber each other?* Elements carry a `version`;
  remote sets merge last-write-wins per element, so both sides converge and
  neither drops the other's elements.
- *How does a late joiner get the board?* The server keeps the live scene in
  memory (debounced-persisted to Mongo) and hands it to any joiner on
  `whiteboard:join`.

---

## 22. Feature: Draw & Guess Game (Skribbl-style)

*(Full template entry: [feature-map F19](notes/feature-map.md) — first mini-game)*

### The Feature
A real-time party game in a room: one player draws a secret word, everyone else
races to guess; speed-based scoring; rounds; final scoreboard. Mobile-friendly.

### What We Did
- **Server-authoritative state machine** (`game.handlers.js`):
  idle→choosing→drawing→reveal→…→ended, all timers/word/scoring on the server.
  Guessers get a **masked** word (hint letters reveal over time); the drawer gets
  the real word **privately** (a per-user socket room `user:<id>`).
- **Scoring:** guesser `50+300·(timeLeft/turn)` (50–350, faster=more); drawer
  `+40`/correct guesser. Turn ends on timeout or when everyone's guessed.
- **Presence-driven players** (built from who's in the room; guests included);
  drawer-disconnect skips the turn.
- **Responsive canvas:** fixed 1000×600 buffer scaled by CSS + **normalized
  0..1 stroke coords** → crisp and identical on phone/laptop; Pointer Events +
  `touch-none` for finger/stylus. Palette, eraser, brush size, clear.
- **RoomPage** now has a **Room / Board / Game** switcher; the call keeps
  running hidden underneath.

### Challenges / Design Notes
- **Server must be authoritative** — the word, timers, and scoring can't live on
  the client (cheating). Guessers never receive the word until the turn ends.
- **Private word to the drawer:** Socket.io broadcasts hit everyone, so each
  socket joins a `user:<id>` room and the drawer's word is sent only there.
- **Responsive drawing across devices:** normalized coordinates + a fixed
  internal buffer make one stroke look the same everywhere without redraw-on-resize.

### Verification
Live 2-socket script: start, private word, correct guess, speed scoring
(drawer +40 / guesser +350), duplicate-guess ignore — all passed. 81 backend
tests green; lint + build clean.

### Interview Q&A
- *Why is the game state on the server, not the client?* It's authoritative:
  the secret word, the countdown, and scoring must be tamper-proof; clients only
  render what the server tells them (guessers get a masked word).
- *How does only the drawer get the word?* Every socket joins a personal
  `user:<id>` room; the word is emitted only to the drawer's room.
- *How is the canvas responsive?* Strokes are normalized to 0..1 against a fixed
  1000×600 buffer, then CSS-scaled — so a phone and a laptop see the same drawing.

---

## 23. Feature: Ludo — Board Game (2–4 players)

*(Full template entry: [feature-map F20](notes/feature-map.md) — second mini-game)*

### The Feature
Classic Ludo in a room: seat up 2–4 players, roll to leave base, move/capture,
race all four tokens home. Server-authoritative.

### What We Did
- **Step-based board model:** a token is a single number 0..57 (yard → 52-cell
  shared track → home column → center). The server runs every rule from just
  that plus start-offsets, a safe-cell set, and a `trackIndex()` helper — captures
  are "two tokens with the same track index on a non-safe cell."
- **Rules:** 6 to leave base, exact-roll to finish, capture-to-base on shared
  non-safe cells, safe stars, extra turn on 6/capture/home, 3-sixes forfeit,
  all-4-home win. Dice + turn order + board all live on the server.
- **Client geometry:** the 15×15 board coordinates (track path, home columns,
  yards) live only on the client, which maps each `step` to a `[row,col]`.
- **Two games now** share the 🎮 Game tab via a chooser (Draw&Guess | Ludo).

### Challenges / Design Notes
- **The whole game reduces to one integer per token.** Modeling position as a
  0..57 `step` (not board x/y) makes moves, captures, home, and win trivial and
  keeps the server tiny; rendering geometry stays entirely on the client.
- **Server-authoritative dice:** the roll and legal-move computation are on the
  server so a client can't fake a 6 or an illegal move.
- **Test flakiness (not a code bug):** running 10 suites that each boot an
  in-memory Mongo in parallel *while the dev servers were running* timed out;
  `--maxWorkers=2` → all 81 green. Worth remembering for CI tuning.

### Verification
Live 2-socket driver: seats, start, tokens leaving base across random turns,
turn rotation — all passed. 81 backend tests green; lint + build clean.

### Interview Q&A
- *How do you represent a Ludo board so the rules are simple?* Each token is a
  single `step` 0..57 along its own path; the shared track is a modular offset
  per color, so captures/home/win are one-line checks. Pixel geometry is a
  client-only concern.
- *Why is the game server-authoritative?* The dice and legal moves must be
  tamper-proof; clients only render and send roll/move intents.

---

## 24. Feature: Friends — requests, list, invite to a room

*(Full template entry: [feature-map F22](notes/feature-map.md) · deep dive: [Part 9](notes/part-9-friends.md))*

### The Feature
A social layer: find people, send/accept friend requests, keep a friends list
(with online status), and **invite a friend straight into a room** — with live
notifications anywhere in the app.

### Ways to Model Friendships
1. Arrays on the User (`friends: [ids]`, `requests: [...]`) — denormalized,
   awkward to query "pending incoming vs outgoing," easy to get out of sync.
2. **(chosen)** A separate `Friendship` collection — one directed row per pair
   (`requester`, `recipient`, `status`) + a **unique compound index**. Clean
   queries, and "are A & B friends?" is a single either-direction lookup.

### What We Did
- **Backend** (`friend.controller.js`, guest-blocked via `requireFullUser`):
  search (annotated with our relationship so the UI shows Add/Requested/Friends),
  send/accept/decline/cancel, list friends (+ online via `fetchSockets`),
  unfriend, and **invite-to-room**. Requests/accepts/invites are pushed live to
  the target's **per-user socket room** (`user:<id>`) — the same channel the game
  uses to send the drawer their word.
- **Frontend:** a global `notify` store + `Toaster`, and an **app-wide socket
  listener in `App.jsx`** so friend events pop a toast on any page (not just in a
  room). `FriendsPage` (debounced search, requests, list), an `InviteFriends`
  dropdown in the room, and a Dashboard Friends link with a pending badge. The
  invite's "Join" reuses the existing `/join/:code` flow.
- **Tests:** 12 supertest cases (suite → **93 green**) — this feature has real
  automated coverage, unlike the socket-only ones.

### Challenges / Design Notes
- **Preventing duplicate/reverse requests:** the unique `(requester, recipient)`
  index stops A→A twice, and the controller checks the reverse (B→A) before
  creating A→B, so a pair can never have two rows.
- **Where the socket listener lives:** app-wide (in `App.jsx`), gated on
  `authed && !guest`, so invites arrive regardless of which page you're on.
- **Invites are fire-and-forget:** an offline friend simply misses it (no
  persistent invite store yet — a clear future enhancement).

### Interview Q&A
- *Why a separate Friendship collection over arrays on User?* Clean, indexable
  queries for pending/accepted in both directions, and no two-sided sync bugs.
- *How does a real-time invite reach a specific user on any page?* Every socket
  joins a personal room `user:<id>`; the server emits the invite there, and an
  app-level listener shows a toast.
- *Why can't guests use friends?* Guests are ephemeral (auto-expire) and
  room-scoped; `requireFullUser` returns 403 on all friend endpoints.

---

## 25. Feature: Smash Karts — real-time 2D deathmatch

*(Third mini-game — the first CONTINUOUS/real-time one, not turn-based)*

### The Feature
A top-down car-battle arena in a room: up to 6 players drive around a 1600×900
arena, shoot each other, respawn on death, grab health / rapid-fire pickups.
Most kills in a 3-minute match wins. Inspired by SmashKarts, built from scratch.

### Options Considered
- **3D (Three.js + a physics engine) vs. 2D top-down canvas.** Chose **2D**: it
  reuses the existing socket/room/GamesHub stack, ships an MVP in days not weeks,
  runs smooth on any device, and keeps the *same* "drive + shoot + respawn" loop.
  3D would reuse almost none of the current architecture.
- **Win condition:** deathmatch (most kills) vs. last-kart-standing vs. race+combat.
  Chose **deathmatch** — closest to the reference and simplest to make fun.

### What We Did
- **The one new architectural muscle: a server tick loop.** Ludo/Skribbl are
  event-driven (react to a roll/guess). A shooter can't be — the server runs a
  fixed **30 Hz `setInterval`** per active arena that integrates physics and
  broadcasts a world snapshot at **~15 Hz** (`SNAPSHOT_EVERY = 2` ticks).
- **Server-authoritative everything.** Clients send only compact input
  (`throttle`/`steer`/`shoot`, each clamped to [-1,1]); the server owns every
  position, bullet, hit, score, and respawn. A client can lie about its input,
  never about the outcome — the only way a shooter stays fair.
- **Pure physics core** (`games/kartArena.js`): arcade car model (one speed
  scalar along the heading; steering effectiveness scales with speed and flips
  in reverse), wall clamping, bullets with TTL + circle-hit detection, respawn
  timers, and health / rapid-fire pickup pads. Kept socket-free so it's unit-testable.
- **Client is a dumb renderer** (`hooks/useKart.js` + `components/KartPanel.jsx`):
  snapshots land in a **ref** (not React state — 15 re-renders/sec would thrash),
  and a `requestAnimationFrame` loop draws the world on a `<canvas>`,
  **interpolating** each kart between the last two snapshots for smoothness.
  Keyboard (WASD/arrows/Space) → input, streamed only when it changes.
- **Three games** now share the 🎮 tab (Draw&Guess | Ludo | Smash Karts), plus a
  `kart` activity announcement ("X started Smash Karts 🏎️").

### Challenges / Design Notes
- **Re-render vs. render.** The hard part of a real-time UI in React is *not*
  rendering through React. Snapshots go to a ref; React state only flips on
  coarse lobby↔playing↔ended changes. The canvas is the render target.
- **Client interpolation hides the 15 Hz wire rate.** Rendering the newest
  snapshot raw looks choppy; lerping position + shortest-path angle between the
  previous and current snapshot makes 15 Hz feel like 60.
- **Input as a signature.** The client only emits `kart:input` when the
  throttle/steer/shoot tuple actually changes (`"1|0|true"` string compare),
  plus a `window.blur` reset so a dropped keyup doesn't leave a car stuck at
  full throttle. Server keeps the last input between messages.
- **Lifecycle cleanup.** The tick loop is a live `setInterval` — it's cleared on
  match end, host reset, and when the last player disconnects (mirrors the
  state-cleanup pattern from the socket-hardening pass, so an empty arena never
  leaks a timer).

### Verification
101 backend tests green; backend + frontend lint clean; `vite build` succeeds.
Manual playtest: 2 browser tabs → join, host start, drive/shoot/respawn,
pickups, kill feed, 3-min timer → scoreboard.

### Interview Q&A
- *How is a real-time multiplayer game different from your turn-based ones?*
  Turn-based games react to discrete events; a shooter needs a continuous
  server-side simulation. I added a 30 Hz authoritative tick loop that steps
  physics and broadcasts snapshots at 15 Hz — clients only send input.
- *Why send snapshots at 15 Hz but render at 60?* Bandwidth. The client
  interpolates between the two most recent snapshots (position + shortest-path
  angle), so it looks smooth without 60 messages/sec per player.
- *How do you keep it fair / cheat-resistant?* The server is authoritative over
  all state; the client's only input is clamped throttle/steer/shoot. It can't
  place itself, fake a hit, or award itself a kill.
- *Why a ref instead of React state for the game state?* 15 snapshots/sec through
  `setState` would re-render the whole tree 15×/sec. The canvas reads a mutable
  ref in its rAF loop; React only re-renders on lobby/playing/ended transitions.

### Update — went 3D (Three.js), server untouched
Playtesting the 2D top-down build, it felt flat / not fun. Pivoted to a **3D
chase-cam** renderer — and the payoff of the authoritative client/server split
showed up here: **zero backend changes were needed**. The server already
simulates karts on a flat plane (x, y, heading, speed); in 3D that's just the
ground plane (x → x, y → z, heading → yaw). So:
- Kept **all** netcode, physics, hit detection, scoring, the 30 Hz tick loop.
- Swapped **only the client renderer**: 2D `<canvas>` → a Three.js scene
  (`KartArena3D.jsx`) with ground/grid/walls, box-model karts, sphere bullets,
  spinning pickups, floating name+HP sprite labels, and a **chase camera** that
  lerps behind the local kart. Same snapshot interpolation as before.
- HUD moved from canvas-drawn to a **DOM overlay** (timer/leaderboard/kill-feed/
  HP), refreshed at 5 Hz — never per frame.
- `KartArena3D` is **lazy-loaded** so Three.js (~530 kB) only downloads when the
  game is opened, keeping it out of the main bundle.
- Tuned the physics constants (faster top speed, snappier steering, faster
  bullets) for a punchier arcade feel.

**Interview takeaway:** because the client was always a "dumb renderer" over
server snapshots, changing the *entire* visual dimension (2D→3D) was a
renderer-only swap. That's the whole argument for server-authoritative design in
one commit.

### Graphics polish pass (all three games)
A dedicated visual upgrade — again, **no game logic touched**, purely renderers:
- **Smash Karts 3D:** soft shadow maps (`PCFSoftShadowMap`), ACES filmic tone
  mapping, a gradient sky, neon-strip walls, a richer kart model (spoiler,
  driver head, metallic body), glowing bullets, **kill explosions** (additive
  particle bursts triggered on an alive→dead transition), **hit flashes**
  (emissive pulse when HP drops), a **rapid-fire aura** ring, and point-lit
  spinning pickups.
- **Ludo:** glossy radial-gradient tokens with depth shadows, gradient base
  quadrants, smooth CSS move-transitions, styled safe-star/start cells, a
  trophy center, and a framed board.
- **Draw & Guess:** expanded 14-swatch palette, a toolbar card with a **live
  brush preview** and sized slider, and a shadowed canvas surface.
- Kept `KartArena3D` **lazy-loaded** so Three.js stays out of the main bundle.

### Maps, powerups, and game modes
A big content expansion for Smash Karts — new data + physics on the server, new
rendering on the client:
- **Two maps** (`kartMaps.js`, mirrored server + client): **Speedway** (stadium,
  neon walls, tyre chicane) and **Forest** (trees, fallen logs, rocks). Each has
  its own theme (sky gradient, floor/wall colors) and obstacle layout. Obstacles
  are real colliders — **circles** (tyres) and **capsules** (logs) — that push
  karts out and block bullets. Host picks the map in the lobby.
- **Powerups (5):** ❤️ health, 🔥 rapid-fire, ⚡ speed-burst (1.6× top speed +
  accel), 🛡️ shield (5 s invulnerability), and 💀 **bomb** — a "suicide" pickup
  that detonates after a 5 s fuse, dealing area damage to nearby enemies (the
  carrier gets a red pulsing aura + a floating countdown, then a big blast).
- **Two modes:** **FFA** (free-for-all, most kills) and **TDM** (team deathmatch
  — auto-split teams, friendly fire off, team-summed scores, team-colored rings +
  leaderboard). Host picks the mode in the lobby.
- **Leave-with-confirmation:** an in-match "← Leave game" opens a modal; confirm
  drops you from the arena and back to the games menu.
- **Bandwidth note:** obstacle layouts are static, so the wire only carries the
  `mapId` — the client renders obstacles from its mirrored `kartMaps.js` (same
  pattern as `ludoBoard.js`). Kept snapshots tiny.

### Ludo UX fix
The always-on **VoiceBar** (mic/video) was centered at the bottom, overlapping
the Ludo board (and kart HUD). Moved it to a vertical pill anchored on the
**right edge, vertically centered** — clear of every centered board and the
bottom touch controls.

### Cinematic graphics pass — bloom, living backgrounds, Volcano map
A renderer-only upgrade (zero game-logic changes) that moved the game from
"bright pixels" to actual glow and living scenery:
- **Post-processing chain:** `EffectComposer` → `UnrealBloomPass` → `OutputPass`
  (ACES tone map + sRGB). Bloom is what makes neon wall trim, lava cracks,
  headlights, bullets, and explosions genuinely *glow*; strength is tuned
  per-map via the theme.
- **Procedural canvas textures:** asphalt (speckle + tyre scuffs), grass,
  basalt with **synced albedo/emissive crack maps** (the same crack polylines
  stroked dark on one canvas and hot orange on the other, so the glow sits
  exactly in the cracks), stadium crowds, sponsor billboards.
- **Living backgrounds:** Speedway became a *night race* (star field, moon,
  crowd camera flashes, floodlight cones, emissive billboards); Forest got
  two tree species, bushes, a fog-blended mountain-ring horizon, drifting
  clouds, a sun flare, and falling leaves. Every map gained a huge outer
  ground plane so the world no longer floats in a void.
- **New map — Volcano 🌋:** erupting cone (glowing crater, lava streaks,
  looping smoke-plume sprites), pulsing lava pools, basalt columns, rising
  embers, and the glowing-crack basalt floor. Server-side it's pure DATA
  (rock + basalt-ridge colliders, its own pickup layout) — the physics core
  needed no changes and the host's map picker lists it automatically.
- **Kart juice:** spinning wheels + steering front-wheel pivots, body lean in
  corners (inferred client-side from snapshot deltas — no wire changes), skid
  dust, head/taillight lenses (bright at night) + a real `SpotLight` headlight
  beam on the local kart, glowing bullet tracers, and explosions upgraded with
  shockwave rings, flash sprites, and brief dynamic lights.

### Shaped arenas — curvy tracks (Grand Circuit + Canyon)
The arena stopped being "always one 1600×900 rectangle":
- **The trick: curvy walls are just more capsules.** A closed Catmull-Rom
  spline is sampled into a polyline and every segment becomes a `barrier`
  capsule — the *existing* capsule collider (used for logs) handles karts and
  bullets against any curve. The physics core's only change was reading a
  per-map world size (`g.w`/`g.h`) instead of fixed constants.
- **Generator mirrored server + client:** `sampleClosedSpline` / `offsetLoop`
  / `loopCapsules` live byte-identical in both `kartMaps.js` files, so the
  server's colliders and the client's rendered track can never drift apart.
- **Grand Circuit (2400×1500):** a closed curvy ring track — the centerline
  spline (varied radii → sweepers, pinches, S-curves) offset ±115 gives outer
  and inner boundaries. Rendered as a `THREE.Shape` asphalt ribbon with a
  grass infield island, **continuous armco rails** (posts + rail tube + neon
  top tube via `TubeGeometry` along the spline), a checkered start line, and
  sunset-dusk scenery (mountains, floodlights, billboards). Spawns sit ON the
  centerline facing the racing direction (tangent angle).
- **Canyon (2000×1300):** an open curvy blob arena — one winding boundary
  rendered as a rough rock rim, sand floor with wind ripples, mesas + desert
  rocks outside, and drifting dust motes. Rocks and ridges inside for cover.
- **Renderer sizing:** all scenery builders read a `dims` object the map
  rebuild updates (world size, center), and the shadow camera re-fits to the
  map — so bigger arenas "just work".

**Interview takeaway:** the shaped-arena feature cost the server ~6 lines
because the collision primitives were already general. Choosing capsules as
the wall primitive early meant "any curve" was a data problem, not an engine
problem.

### Playtest round 1 → the 10x scale-up
First real playtest feedback drove a big balance/visual pass:
- **All maps ~10x the area** (rects 5200×2900, Canyon 6400×4200, Circuit
  7600×4800 with the track width **doubled** to 460 + a 12-tyre slalom
  alternating sides of the racing line). Physics retuned to match (max speed
  520→660, faster bullets with longer TTL) — and barrier capsule radii were
  bumped WITH the speed so the contact band still exceeds max
  distance-per-tick (the anti-tunneling invariant).
- **Spawn clearance rule:** playtest showed karts boxed in by rocks at spawn
  ("can't move forward"). Every layout now guarantees ≥300 units of clear
  space around each spawn and nothing in the facing line.
- **Readability:** volcano rocks blended into the dark basalt — rock color is
  now theme-driven (`rockColor`/`rockEmissive`): obsidian with lava-lit
  emissive edges on volcano, dark sandstone on canyon. Lesson: contrast is a
  gameplay feature, not an aesthetic one.
- **Scale-aware scenery:** every decoration formula that used fixed distances
  (tree rings, mesas, lava pools, moon/sun/clouds/mountains, floodlights,
  stands, fog near) broke at 3x linear scale — all now derive from a `dims`
  object (perimeter scatter instead of center-radius rings, capped scale
  factors). Shadow map bumped to 4096 to cover the bigger sun frustum.
- **Nitro boost VFX:** the speed pickup now shows flickering additive blue
  exhaust flames, a cyan trail, and an extra chase-cam FOV kick.

### The "Join arena button does nothing" bug — two real defects
Reported after the scale-up; the button looked dead. Debugged by driving the
**real server with a socket script** rather than reading code: `kart:join`
returned `{ok:true}` on a fresh connection, which cleared the server and
pointed at the client. The Vite log then showed the actual trigger —
`ECONNREFUSED` on `/socket.io` when nodemon restarted the backend.

1. **Room membership was never restored after a reconnect.** `useRoomChat`
   did `socket.once("connect", join)`. Socket.io auto-reconnects with a
   **brand-new server-side socket whose `rooms` set is empty**, but `once`
   (already consumed, or never registered when the socket was connected at
   mount) meant `room:join` never fired again. Every guarded event — kart
   join/start, chat send, ludo, skribbl — then failed `socket.rooms.has(...)`
   and returned `{error:"Not allowed"}`, while the UI still looked connected.
   Fix: `socket.on("connect", join)` (+ `off` on cleanup) so membership is
   re-established on *every* connect; `useKart` re-`sync`s on connect too.
   **This would have hit real users on any network blip or redeploy — not
   just dev restarts.**
2. **A map swap didn't update the world size.** `kart:config`/`kart:start`
   refreshed `obstacles`/`spawns` but left `g.w`/`g.h` at the previous map's
   values, so picking Circuit (7600×4800) kept Speedway's 5200×2900 clamp:
   karts spawned outside the bounds, got clamped back *inside a barrier
   capsule*, and genuinely could not move. Fix: one `applyMap(g, mapId)`
   helper that sets every map-derived field, used by both handlers — the
   classic "parallel assignments drift apart" bug, cured by centralising them.

**Also:** the panel now renders the ack's `error` instead of swallowing it —
a silent `{error}` ack is indistinguishable from a dead button.

### More powerups, and bots with difficulty levels (both games)

**Three new Smash Karts powerups** (8 total), all added to the pure core:
- **🔱 Triple shot** — each shot becomes a 3-way spread for 8s.
- **❄️ Freeze (EMP)** — detonates on pickup; every enemy within 340u is locked
  for ~2s (inputs zeroed, kart coasts to a stop).
- **🧨 Mines** — lays a trail of 3 proximity mines behind you; they arm after
  700ms and blast anyone who drives over them. Introduced a new world entity
  (`g.mines`) + snapshot field.

**Shield is now the universal counter** — and it already was for bombs. The
existing `detonate()` skipped shielded victims, so "a shield saves you from the
suicide bomb" was working before this pass; the change was *proving* it and
extending the same rule to mines and freezes. Bomb/mine damage were also
unified into one `areaDamage()` helper so the immunity rules (owner, teammate,
shield) can't drift apart between the two.

**Bots — the payoff of server-authoritative design, again.** A bot is an
ordinary entry in `g.players` carrying `isBot: true`. The *only* difference is
where its input comes from:

```js
for (const p of game.players.values())
  if (p.isBot && p.alive) p.input = botInput(game, p, now);   // vs. arriving by socket
const { kills, booms } = stepWorld(game, dt, now);            // simulation is unchanged
```

The simulation literally cannot tell bots from humans, so **no physics, scoring,
powerup or snapshot code changed at all**. Same story in Ludo: the roll/move
rules were extracted out of the socket handlers into socket-free `doRoll()` /
`doMove()`, and a bot's timer calls exactly the functions a human's socket event
calls. A bot can only pick from `g.movable` — the server-computed legal list —
so **a bot can no more cheat than a client can**.

**Difficulty is a table of knobs, not a different algorithm:**

| | Kart bot | Ludo bot |
|---|---|---|
| **Easy** | 420ms reaction, ±0.30 rad aim wobble, 62% throttle, 620u range, no target leading | picks at random (takes an obvious capture ~half the time) |
| **Medium** | 220ms, ±0.14 rad, 85% throttle, 900u, partial leading | greedy: ranks moves by immediate payoff (capture > home > leave yard > progress) |
| **Hard** | 90ms, ±0.045 rad, full throttle, 1250u, full predictive leading | scores payoff **minus risk** — counts how many enemies could reach the landing square next roll, and prefers relocating threatened tokens |

Kart bots also seek pickups (health when hurt), avoid obstacles via whisker
probes, refuse to shoot through walls (sampled line-of-sight), and back off from
a bomb carrier.

**Lifecycle detail worth keeping:** bots must never keep a game alive. Both
cleanup paths now count *humans* only — otherwise a lobby of bots would hold a
30 Hz tick loop (or a Ludo turn timer) open forever after the last person left.
A bot also can't become host.

**Tests: 37 new unit tests** (backend suite 101 → **138**) — the first real
coverage of the kart core, which was possible only because it's socket-free.
They pin the shield rules (bomb / bullet / mine / freeze / friendly-fire), each
new powerup, and bot *behaviour* rather than config: easy is measurably slower,
wobblier and shorter-ranged; medium takes a greedy move that hard rejects as too
exposed.

**A bug the tests caught:** kart bots reversed for the first half-second of
every life. The stuck-detector compared the bot's position against a baseline
that defaulted to *its own current position*, so the first sample always read
"hasn't moved". Fixed by treating the first sample as baseline-only — a good
reminder that `?? self` defaults can silently fabricate a false measurement.

### "The kart can't move forward" — finally root-caused (twice)
Reported three times. The first two fixes (spawn crowding, per-map world size)
were real but weren't the whole story. This time I stopped reading layouts and
wrote a **headless drive test**: put a kart at every spawn of every map, hold
full throttle for 3s, measure distance. Two spawns moved 356u out of a possible
~1980u. Two genuine defects:

1. **Karts were being PINNED to walls.** Collision did `p.speed *= 0.35` on
   every contact, every tick. Since steering authority scales with speed, a kart
   that touched a wall lost its speed → couldn't turn → stayed touching the wall.
   Worse, a curvy track edge is ~80 barrier capsules and the penalty applied
   once *per capsule*, compounding to 0.35ⁿ — instant paralysis. Replaced with
   proper **sliding collision**: push out along the surface normal, then scale
   speed by how head-on the contact was (`1 - 0.85 × alignment`), applied **once
   per tick** using the worst contact. Head-on still hurts; a glancing scrape
   now barely slows you and you slide along the wall like a real racing game.
2. **Two spawns faced directly into a barrier log** 400u away. My earlier
   "clearance" check only measured *radial* distance — it never checked what was
   in the direction the kart was pointing, even though the notes claimed it did.
   Mid-arena spawns now face along the open axis.

The durable fix is `tests/kart.maps.test.js`: **every spawn on every map is
driven for 3 seconds** and must cover >700u, plus wall-behaviour tests (head-on
bleeds speed, glancing keeps it, a pinned kart can reverse out, a capsule chain
doesn't compound, a kart spawned inside geometry is pushed out rather than
flung). Layout edits can no longer reintroduce this class of bug silently.

### Weapons overhaul — 14 powerups
Six new pickups, all table-driven so adding a weapon never touches collision or
damage code. Weapons **replace** your blaster until their ammo runs out, which
makes picking one up a real trade-off.

| Powerup | Effect |
|---|---|
| 🔫 **Shotgun** | 5-pellet cone, 8 shells — devastating in a brawl, useless at range |
| 🔺 **Laser** | Hypersonic **piercing** railgun, 4 shots — skewers a whole line of karts |
| 🚀 **Homing** | 3 missiles that curve toward the nearest enemy |
| ⚙️ **Spike armour** | Ring of spikes; ramming deals 34 damage + knockback (per-victim cooldown) |
| 🛢️ **Oil slick** | Drops 3 puddles; victims lose grip and spin out |
| 👻 **Ghost** | Near-invisible *and* drives through scenery for 6.5s |

Joining 🔱 triple, ❄️ freeze, 🧨 mines and the original ❤️⚡🔥🛡️💀. Oil slicks
reuse the mine entity list (same lifecycle, different payload). **Shield now
counters everything** — bullets, bombs, mines, spikes and freezes.

**A bug the tests caught: bullet tunnelling.** The laser travels 2300 u/s = ~77u
per 30 Hz tick, but a kart is only ~54u across — it flew straight through
targets without ever registering a hit. Fixed with **swept collision**: bullets
advance in sub-steps no larger than a car radius. A weapon fast enough to be
exciting was fast enough to be broken, and only an integration-level test
("does the laser damage two karts in a line?") would have shown it.

### Kart model rebuilt
Replaced the box-primitive kart with proper bodywork: a tapered ellipsoid tub,
sculpted nose cone, side pods with chrome intakes, roll-cage hoop, rear wing on
twin pylons, a real cockpit (recessed tub, seated driver, helmet with a curved
visor, steering wheel) and a roof-mounted cannon with a muzzle. Wheels are now
groups — fat rears, spoked chrome hubs — which also fixed their rotation axis
(they were being yawed around Y instead of rolled about the axle).

### Performance pass — why Smash Karts "lagged in between"
Player-reported stutter. Profiling the renderer surfaced four compounding
GPU costs (no single bug — a budget problem):
1. **Shadow pass dominated.** A 4096² PCFSoft shadow map re-rendered EVERY
   frame, with a shadow camera stretched over the decorative ring — so ~200+
   perimeter trees/mesas/posts were re-drawn into the shadow map per frame.
   Fixes: 2048² PCF (soft-PCF is the priciest filter) and the shadow camera
   fit to the ARENA only, which both doubles texel density and lets three.js
   frustum-cull all perimeter decor out of the shadow pass.
2. **DPR up to 2 + full-res bloom.** Devices report DPR 2/3; shaded pixels
   scale with DPR² and UnrealBloomPass's blur chain scales with its input size.
   Fixes: DPR capped at 1.5, bloom fed a half-resolution vector.
3. **Wasted MSAA.** `antialias:true` only affects the default framebuffer, but
   with an EffectComposer the scene renders into an offscreen target — the
   MSAA never touched the 3D image. Turned off; pure bandwidth win.
4. **No adaptation.** Added a quality governor: an exponential moving average
   of frame time steps through 3 tiers (DPR 1.5/shadows 2048/bloom →
   DPR 1.25/1024/bloom → DPR 1/no shadows/no bloom) with 2s hysteresis, so a
   weak iGPU degrades gracefully instead of stuttering.
**Lesson:** "sometimes lags" usually means the frame budget is exceeded only
when everything peaks at once (shadow refresh + bloom + many casters). Fix the
budget, not a bug.

### The performance fix that made it WORSE (playtest round 2)
The first pass shipped two clever-sounding ideas that backfired, and the
player immediately felt it ("lagging even more now"):
1. **Half-rate shadows caused judder.** Refreshing the shadow map every OTHER
   frame halves the *average* cost but makes frames alternate cheap/expensive.
   Under vsync that becomes a 16/33/16/33 ms cadence — motion advances
   unevenly, which *feels* worse than a steady lower frame rate. Reverted:
   shadows now update every frame; **even per-frame cost beats lower average
   cost**. Smoothness is about variance, not the mean.
2. **The governor measured the wrong clock and could oscillate.** It timed the
   JS inside the frame — but GPU-bound lag shows up as *late rAF callbacks*
   (back-pressure), not slow JS, so the number looked fine while the game
   crawled. It now uses frame-to-frame delivery time. And since every tier
   change reallocates render targets (composer chain + shadow map = a visible
   hitch), stepping down→up→down every few seconds was itself a stutter
   generator. Fixed with a failure latch: a tier that ever failed is never
   re-entered, and the average resets after each change (old samples describe
   the old tier). Added an on-screen `fps · quality` readout so lag reports are
   measurable instead of vibes.
3. Bonus find: the engine-hum updater called `ctx.resume()` 60×/s before the
   first user gesture — a rejected promise + console warning per frame.
**Lesson:** performance work needs the same regression discipline as
correctness work — measure the thing the player feels (frame *pacing*), not
the thing that's easy to measure (average cost).

### Audio — synthesized SFX + generative music for all three games
No audio files at all: every effect is a WebAudio recipe (oscillator sweeps,
filtered noise bursts through gain envelopes), and background music is a tiny
16-step generative sequencer (bass/lead/hat patterns per game) using the
standard lookahead-scheduling pattern. Why synthesis: zero assets to license,
host, or download (free-tier friendly), retro fit, and sample-accurate timing.
- **Autoplay policy:** an AudioContext starts suspended; a one-time
  pointerdown/keydown listener resumes it, so audio "just works" at first
  interaction with no permission UI.
- **Wiring principle: sounds come from STATE DIFFS, not extra events.** The
  kart engine hum follows my snapshot speed; pickups/nitro/shield/freeze/death
  are transitions of my player's flags between snapshots; Ludo captures/homes
  are board diffs — which means BOT moves are audible exactly like human
  moves, and the server needed zero new events for any of this.
- Muzzle sounds are inferred: a bullet that appears within ~90u of my kart is
  mine; its snapshot `kind` picks the recipe (blaster/shotgun/laser/homing).
- One mute toggle (localStorage) in the GamesHub header covers everything.

### Rooms: public/private + unique names; games: spectate-only mid-match
- **Visibility**: rooms are `private` (invite-code only, the old behavior) or
  `public` (listed on a Discover section, joinable by id without a code — and
  the public shape deliberately omits the invite `code`, so discovery can't
  leak the private-style door key).
- **Unique names, race-safe**: a `nameLower` shadow field with a unique index
  (sparse — legacy rooms lack it). Two simultaneous creates both pass any
  pre-check; only one wins the index; E11000 on `keyPattern.nameLower` maps to
  a 409. The same catch guards renames. Lesson: uniqueness lives in the
  database, not in a find-then-insert.
- **Spectate lock**: joining a kart match or skribbl round in progress now
  returns `{spectate:true}` instead of a seat (ludo already refused). Clients
  show a "👀 spectating" banner; skribbl auto-claims a seat the moment the
  round ends. Rationale: fresh full-health players dropping into a live match
  was unfair, and skribbl scoring assumes you were there for the round.

### Ludo round 2 — reactions, chat, AFK enforcement, real pieces
- **Emoji reactions** (`ludo:emoji`, rate-limited 6/4s): 😡🔥😘❤️🔫 float up
  over the board, big (text-6xl) with per-emoji CSS animations (angry wiggles,
  love pulses, gunshot recoils…) + a matching synth sound. Broadcast to the
  whole room so spectators see them too.
- **In-game chat** rides the EXISTING `message:send`/`message:new` events — a
  compact panel that just listens and sends. No new server code, and messages
  land in the room's persistent history like any other chat line. (Careful
  detail: it must NOT reuse `useRoomChat`, whose cleanup emits `room:leave`.)
- **AFK enforcement, server-side**: every state change flows through
  `broadcast()`, which doubles as the arming point for a turn deadline
  (30s to roll / 15s to move, `turnDeadline` in the payload so clients render
  a countdown). Timeout → server rolls, waits 1.5s so the dice is visible,
  moves a random legal token. Only turns where the ROLL was auto count as
  strikes; 3 consecutive → seat ejected (tokens cleared, turn order respliced,
  host reassigned if needed, last player standing wins). Manual action resets
  strikes. Verified live end-to-end: 2 warnings → kick → win.
- **Visuals**: big clickable 3D-look dice (pip grid, spin animation, glow on
  your turn) on the LEFT rail with the countdown bar; tokens are now SVG pawns
  (radial-gradient head, tapered body, ground shadow) instead of flat circles.

### Kart round 3 — 10-player arenas, host match controls, perf pass 3
- **10 karts** (was 6): 4 new seat colors, MAX_KARTS bump — and 10 spawns per
  map. The interesting part: circuit grid slots are now **picked by
  simulation** — hand-choosing evenly-spaced spline indices put two slots
  facing into hairpins (the drive-test caught it), so a script drives every
  track sample at full throttle and selects 10 well-spread ones that clear
  850u. Layout data chosen by the same test that guards it.
- **Host controls** (host = first human to join, already the hostId rule):
  match length (60–600s, clamped server-side), TDM team RENAMES (16-char cap,
  whitespace-normalized), and manual team pinning via `kart:setTeam` — the
  balancer now respects pins and only distributes the unassigned. Team names
  flow through snapshots into the lobby, live HUD and podium.
- **Perf pass 3** (draw-call/CPU round, after the pacing round):
  - `matrixAutoUpdate=false` for the whole map group — hundreds of static
    scenery objects were having their local matrices recomputed EVERY frame;
    only the genuinely animated sprites (clouds, smoke plume) stay dynamic.
  - Wheels were 6 meshes each (tyre+hub+4 spokes) = 24/kart = ~240 objects at
    full capacity. Baked the metalwork into ONE shared merged geometry
    (transforms applied through a scratch Object3D so euler order matches),
    shared materials across all karts → 2 meshes/wheel, 8/kart.
  **Lesson:** object COUNT is its own budget — matrix updates, frustum tests
  and draw calls all scale with it, and merging static sub-meshes is the
  cheapest big win.

### The arcade gets its own identity
The platform chrome is violet (`brand`); the Games tab now has its own
`arcade` palette — neon cyan/teal with amber as the secondary accent. The two
sit opposite-adjacent on the wheel (the classic synthwave cyan↔violet
pairing), so the arcade **complements** the platform without repeating it.
Implementation: a second Tailwind color family + an `arcade` Button variant,
a themed shell around the whole Games tab (teal gradient wash, faint CRT
scanlines via a repeating-linear-gradient, neon borders/glows), and accent
swaps inside the game panels only — the rest of the app stays violet.
**Lesson:** a sub-brand is a design-token change, not a redesign: because all
accents flowed through `brand-*` utility classes, re-theming a whole section
was one palette + ~30 class swaps.

### Four games in one pass — chess, UNO, typing race, bingo
The platform's 4th–7th games, and the proof of a thesis: after three games
built by hand, the common shape was obvious, so this batch started with a
**shared lobby framework** (`sockets/lobbyGame.js` + `useLobbyGame` +
`GameLobby.jsx`): seats, host powers, bots with difficulty, start/reset,
spectate lock, AFK deadlines, private per-seat state, tickers, and
last-human-leaves cleanup — written ONCE. Each game then shipped as a pure
rules module + a config object + a UI panel.

- **Chess** rides `chess.js` for legality (never hand-roll castling/en
  passant when a battle-tested MIT lib exists) and adds a real bot: easy =
  random-ish, medium = greedy 1-ply, hard = 2-ply minimax with alpha-beta
  over material + piece-square tables. Tests prove hard takes hanging queens
  and finds mate-in-one. UI: animated glyph pieces, legal-move dots,
  promotion picker, per-move clock (timeout = loss).
- **UNO**: full 108-card engine (skip/reverse/draw2/wilds, 2p reverse=skip,
  discard reshuffle) as a pure module with ~10 rule tests. Hands are private
  via the framework's per-seat channel; the server auto-announces "UNO!"
  (fun without the gotcha penalty). Bots hoard wilds and punish low-card
  opponents at hard. CSS-only card art (gradient faces, slanted oval).
- **Typing race**: server validates progress (monotonic + a 250-WPM clamp —
  never trust a client that claims 2,500 chars/sec) and simulates bots as
  WPM profiles with micro-pauses. Racetrack lanes with cars, live WPM,
  countdown beeps, podium.
- **Bingo**: framework ticker IS the caller (a ball every 3.5s as its own
  animated event). Daubs and BINGO claims are server-verified — false calls
  get publicly shamed instead of trusted.

All four verified live end-to-end (17 checks: FEN sync exact after 5 moves,
bot replies, UNO bots finished a real match, race ranked both finishers,
bingo rejected an uncalled daub and a false BINGO). Suite: 187 → **210**.

**Interview takeaway:** the marginal cost of game #7 was a fraction of game
#1 — that's what extracting the framework at the right moment (after three
concrete examples, not before) buys you.

### Round 2 on the new games — clocks, stacking, first-to-finish, PUZZLES
- **Chess clocks**: host picks a time control in the lobby (1/3/5/10/15 min
  or clockless); both sides get the same budget; thinking time is deducted
  ON move, and the framework's AFK deadline doubles as the flag-fall timer —
  first clock to hit zero loses (`timeout` result), bots included. Needed
  one framework addition: `lobbyEvents` (host-only settings pre-start) and
  an `onReset` hook so rematches keep the chosen control.
- **UNO stacking house rule**: +2 answers +2, +4 answers +4 (`u.stack`
  accumulates); the victim may ONLY stack the same type or swallow the whole
  pile. No cross-stacking. Bots stack when they can. The old
  instant-penalty tests were rewritten for the new semantics.
- **Typing race**: the FIRST finisher now ends the race for everyone
  (standings = finishers, then distance covered); solo start = a WPM
  speed-test with a personal stats card.
- **Chess puzzles — GENERATED, not curated.** The question was "can we have
  random daily puzzles?" — answer: generate them. Random sparse positions
  (edge-biased hunted king) are validated by chess.js and then SEARCHED for
  a forced mate (forcing-move candidates, full defense verification), so
  every puzzle ships with a machine-checked proof of solvability. Easy =
  mate-in-1, medium/hard = forced mate-in-2 (hard adds defenders). The
  DAILY puzzle seeds the RNG from the date — everyone gets the same one.
  Generation is chunked async (15 attempts per event-loop turn) so the UI
  never freezes; typical latency 0.1–1s. Solving verifies every user move
  keeps the mate forced (`defenseCannotEscape`), replies with a random
  losing defense, and tracks a per-day streak in localStorage.
- **Flake fixed**: the typing-bot test could randomly hit the bot's 6%
  "humanizing micro-pause" on its single tick — tests that touch randomness
  must either seed it or iterate past it.

**Interview takeaway:** "generate puzzles" beats "find a puzzle API": zero
external dependencies, offline-friendly, infinite supply — because chess.js
makes VERIFYING a forced mate cheap, and verified-random beats curated.

### Playtest polish round — refresh-proofing, auto-moves, modes, turn-pick bingo
- **Refresh no longer ejects you from a game.** The room tab and selected
  game were React state → F5 reset both to defaults. Now persisted in
  sessionStorage keyed per room (`groot:view:{roomId}` / `groot:game:{...}`)
  — per-browser-tab semantics are exactly right for "restore THIS tab where
  it was", and it clears itself when the tab closes. (URL params were the
  alternative; sessionStorage won because game panels are nested state the
  router doesn't own.)
- **Ludo auto-move**: exactly one legal token after a roll → the server plays
  it after a 900ms beat (long enough to read the dice). No decision = no
  wait. Guarded against races (only fires if still that color's un-acted
  turn).
- **Typing modes made visible**: host-picked Race (first finisher ends it)
  vs Practice (everyone types to the end — the WPM-test mode), as lobby
  cards with descriptions. One `mode` param through `raceOver` — the engine
  supports both semantics with two lines.
- **Bingo turn-pick variant** (the schoolyard classic): every card is a
  random ARRANGEMENT of 1–25; players call numbers turn-wise; a call daubs
  every card simultaneously (all cards share all numbers — the game is
  pure arrangement + call strategy); first to FIVE complete lines (rows,
  cols, diagonals; overlaps count — 12 possible lines) wins automatically,
  server-verified. Greedy bots pick calls that maximize their own line
  growth. Rules for both modes are written INTO the lobby. Live-verified by
  actually winning a game 5-lines-to-bot with a call-my-own-card strategy.

**Interview takeaway:** the same lobby framework absorbed a per-game mode
system (chess time controls, typing race/practice, bingo classic/turns) with
one generic `lobbyEvents` hook — settings are just host-only events that
happen to fire before start.

### Typing: the 60-second test + the platform's first GLOBAL leaderboard
- **Timed mode** (replaces Practice): 60 seconds over an ENDLESS stream of
  random common words (monkeytype-style). Implementation trick: no protocol
  change at all — the "text" is simply 280 random words (~1,600 chars),
  which exceeds the anti-cheat ceiling (21 chars/s × 60s = 1,260), so the
  stream can never run dry for a legitimate typist. The UI renders a
  sliding window (word-aligned, ~45 chars behind the cursor), the clock is
  front and center, and only the clock can end the run.
- **Why records come only from timed mode**: fixed duration = comparable
  numbers. Race passages vary in length/difficulty; 60 fixed seconds makes
  "96 wpm" mean the same thing for everyone.
- **TypingRecord model**: one row per user (their personal best), `submit()`
  is a race-safe conditional upsert (`findOneAndUpdate {wpm: {$lt}}` +
  E11000-tolerant insert), top-10 = an indexed sort. Bots and sub-25-char
  runs are excluded. The finish path sets a synchronous `_finishing` flag —
  the 500ms ticker could fire again during the async Mongo write and
  double-submit otherwise.
- Live-verified with two real 60s runs: a 96-wpm run landed on the board,
  a deliberate 36-wpm rerun did NOT override it.

### Animated sticker reactions (all games) + moderation basics
- **Stickers replace the unicode emoji reactions**: six hand-crafted animated
  SVGs (beating heart, flickering fire, shaking angry face w/ steam, blowing
  kiss, recoiling pistol w/ BANG burst, laughing-crying with flying tears) —
  vectors with internal keyframes, so they scale crisply at any size with
  ZERO image assets to load or license. One shared system
  (`useReactions`/`ReactionBar`/`ReactionOverlay`) + a framework-level
  `:react` event means chess/UNO/bingo/typing got reactions for free and
  ludo migrated onto the same rails. Spectators can react too.
- **Moderation basics** (the prerequisite for advertising public rooms):
  - Kick (rejoinable) vs Ban (blocked at code-join, public-join AND
    `canAccessRoom` — a ban trumps even a guest token scoped to the room).
    Eject = drop membership + `socketsLeave` the socket.io room (games/chat
    die instantly) + a `room:kicked` event the client turns into a polite
    redirect. Ban list with names is owner-only info; unban restores.
  - Slow-mode: owner picks 0/5/15/30s; enforced in the chat socket handler
    with an in-memory per-user clock (owner exempt); the client shows the
    server's "wait Ns" message inline. Friction, not security — per-process
    state is fine for that.
  - Reports: stored in Mongo with denormalized names, deduped per
    reporter→target per room per hour. No admin UI yet — a queryable paper
    trail is the minimum viable moderation.

**Interview takeaway:** ban enforcement belongs in the ONE access chokepoint
(`canAccessRoom`) that both REST and sockets already share — adding it there
covered chat, games, and media in one line instead of N.

### Call recording — client-side, free-tier honest
The landing page once promised "cloud recording via a Kafka pipeline". The
truth: server-side compositing/encoding (mediasoup plain-RTP → ffmpeg) is
the single most expensive workload this project could run — it would eat a
free VM whole. The 90% solution costs the server NOTHING:
- `lib/recorder.js`: a hidden canvas composes the call each frame
  (screen-share hero + camera strip, else auto grid; audio-only members get
  initial tiles), WebAudio mixes every participant's audio into one track,
  and `canvas.captureStream + MediaRecorder` writes VP9/VP8 webm in 1s
  chunks — a crash loses at most a second. Stop → instant local download.
  Dynamic joins/leaves work because the compositor re-reads its sources
  every frame. ~200 lines, zero assets, zero server involvement.
- **Transparency is non-negotiable**: a `recording:set` socket event keeps a
  per-room recorders map; everyone gets a red banner (late joiners learn via
  the join ack; a recorder that disconnects can't leave a stuck indicator),
  and a blinking REC dot + watermark are baked into the video itself.
- Next steps when wanted: "Save to Google Drive" via the existing Google
  OAuth + incremental drive.file scope (client-side upload — server still
  never touches video).

**Interview takeaway:** when a feature has a 100% version that needs paid
infra and a 90% version that's free, ship the 90% and say so — client-side
MediaRecorder made "recording" a half-day feature instead of a subsystem.

**Interview takeaway:** "the button does nothing" was never a button problem.
Reproducing against the live server split client from server in one step, and
the dev-server log held the trigger. The deeper lesson is that *reconnect is a
state transition your app must handle* — anything the server stores per-socket
(room membership, subscriptions) has to be re-established on every connect.

### Retention & inclusion pass — push notifications, polls, live captions + translation, face filters
Four features in one pass, all riding rails that already existed.

**Web Push — "a friend started Ludo in your room", even with the tab closed.**
- *Options:* FCM SDK (ties you to Firebase), OneSignal (free tier, third-party
  script + data sharing), or the raw **Web Push standard with VAPID** — keys
  are just a locally generated keypair (`npx web-push generate-vapid-keys`),
  the browser vendors run the relay servers, $0 forever. We chose raw VAPID.
- *What we did:* `PushSubscription` model (endpoint = natural unique key, so
  re-subscribing upserts), `push.service.js` (VAPID-config check with the same
  graceful-degradation convention as S3/OAuth; 404/410 responses auto-prune
  dead subscriptions), `/api/push` routes, `public/sw.js` (service worker:
  push → notification, click → focus-or-open the room), and a header bell
  (`PushToggle`) that deliberately does NOT auto-prompt — permission dialogs
  users didn't ask for get blocked forever.
- *The trigger* hooks the existing `room:announce` event: on any activity
  start, the server pushes to the actor's **friends** who are **room members**
  but have **no socket in the room** (everyone in the room already got the
  toast). Throttled to one push per room+activity per minute — toasts are
  cheap, phone buzzes are not. The friend-invite flow also falls back to push
  when the recipient has no live socket (`isOnline()` already existed).
- *Challenge:* the SW suppresses the notification if a focused tab is already
  on the target page — without that check you get a system banner for a thing
  you're literally looking at.

**Polls — "what do we do next?", one socket event, used every session.**
- *Options:* persist in Mongo (overkill — a poll that outlives the hangout is
  worthless), reuse the seat-based `lobbyGame` framework (wrong shape — polls
  want ALL room members, no seats/host), or a tiny hand-rolled handler like
  whiteboard's. Hand-rolled won: ~120 lines, in-memory `Map<roomId, poll>`,
  one poll per room at a time.
- *Semantics:* anyone can open one when none is running; tap to vote, tap the
  same option to retract; only the creator (or the optional 1–5 min timer)
  closes it; results stay up until the next poll replaces them. Votes are
  public (names on hover) — it's a hangout, not an election.
- Added `"poll"` to `ANNOUNCE_ACTIVITIES` → the tap-to-join toast came free.
  UI is a card at the top of chat with live-animating gradient result bars.
- *Tested* in `sockets.test.js`: full create→vote→retract→close cycle,
  duplicate-poll rejection, creator-only close, non-member rejection.

**Live captions + translation — the "include my grandmother" feature.**
- *The architectural fact that decides everything:* our mediasoup SFU forwards
  **encrypted** RTP — the server never has decodable audio, so server-side
  transcription would need a PlainTransport tap + an STT model (real infra,
  real money). Instead each speaker's own browser transcribes their mic with
  the **Web Speech API** and relays text via a new `caption:say` → `caption:new`
  socket pair (transient, rate-limited, nothing stored — exactly like `typing`).
- *Trade-offs accepted:* recognition is Chromium-only (Firefox users still SEE
  captions, they can't produce them) and Chrome's recognizer stops on silence —
  the hook restarts it in `onend` until the user actually turns CC off.
- *Translation:* viewer picks a target language; final lines (never interims —
  they change too fast to be worth a round-trip) go through `POST /api/translate`,
  a proxy to **LibreTranslate** — free, self-hosted MT added to docker-compose
  (`LT_LOAD_ONLY` keeps it to the 10 languages the UI offers). Env var absent →
  501 → captions simply stay untranslated. Client caches translations and only
  overwrites a caption line if it still shows the same utterance (async race).
- UI: subtitle strip fixed bottom-center so captions survive tab switches
  (voice-while-gaming is exactly when you can't watch the chat pane); CC
  controls live in both the call row and the floating VoiceBar.

**Face filters — Snapchat energy, fully on-device.**
- *Options:* face-api.js (abandoned), TF.js facemesh (older), or **MediaPipe
  FaceLandmarker** (`@mediapipe/tasks-vision`) — actively maintained, 478
  landmarks, WASM/GPU, free, on-device. Chose MediaPipe; the ~3 MB model +
  WASM lazy-load from CDNs the first time a filter is picked, so join-call
  latency is untouched (version pinned to match package.json exactly — wasm
  and JS API ship as a pair).
- *Pipeline:* raw camera track → hidden `<video>` → canvas rAF loop (draw
  frame, `detectForVideo`, draw overlays anchored/rotated/scaled by landmarks)
  → `canvas.captureStream(30)` → **`producer.replaceTrack()`**. The same
  canvas→captureStream trick the recorder already proved; replaceTrack means
  switching filters never renegotiates the call. "None" swaps the raw track
  back and tears the pipeline down (no idle canvas burning CPU).
- Five filters, zero image assets: vector sunglasses/moustache/dog (canvas
  bezier art with gradients, glints, whiskers) and emoji-composited heart-eyes
  and crown (`fillText` scales emoji crisply; hearts pulse on a sine, sparkles
  orbit). All rotate with head tilt via the eye-line angle; two faces
  supported.
- *Subtlety:* `localStream` state is switched to the filtered stream so your
  self-tile AND the recorder show exactly what the room sees, but
  `localStreamRef` keeps pointing at the raw stream — cam/mic toggles and
  cleanup own the real hardware track. The pipeline must never stop the raw
  track it doesn't own.

**Interview takeaway:** all four features were cheap because each rode an
existing chokepoint: push rode `room:announce` + `isOnline()`, polls rode the
socket/room conventions and the announce toast, captions rode the transient-
relay pattern (`typing`) because the SFU's encryption forced client-side STT,
and filters rode `replaceTrack` + the recorder's proven canvas pipeline.
Feature cost is mostly determined by how well the last ten features were
factored.

### Meetings-grade pass — background effects replace face filters, Slack-style chat
Two changes with one theme: the room should feel professional-first, playful
on top (the platform pivot in reverse order of the games work).

**Background effects (blur / virtual backgrounds), Teams/Meet style.**
- *Why the face filters went:* Snapchat overlays read as a toy in the room
  view we now position as "hang out AND take a call in". Background privacy
  is the feature people actually expect from a video call in 2026. The face
  filter code is preserved in git history if a "party mode" ever wants it.
- *Options for segmentation:* TF.js BodyPix (old, slow), WebRTC
  `backgroundBlur` constraint (barely shipped anywhere), or **MediaPipe
  ImageSegmenter** with the selfie model (`@mediapipe/tasks-vision`) — same
  library the face filters already proved, ~1 MB model, WASM/GPU, on-device.
  Obvious continuity win: `lib/faceFilter.js` → `lib/bgFilter.js` keeps the
  identical architecture (hidden video → canvas rAF → `captureStream` →
  `producer.replaceTrack`), only the per-frame math changed.
- *Compositing:* per frame, the segmenter yields a person-confidence mask →
  drawn as soft alpha into a mask canvas (values <0.15 dropped, >0.85 solid,
  linear ramp between — kills mask flicker), person = video ∩ mask via
  `destination-in` with a 1.5px mask blur for feathered edges, over a
  background layer: CSS-filter-blurred video frame (drawn over-scaled so the
  blur doesn't leave transparent fringes), a procedural gradient scene, or an
  uploaded photo (`object-fit: cover` math). Scenes are painted ONCE per
  resolution — aurora/sunset/forest/graphite gradients + radial glows match
  the platform's aesthetic with zero image assets.
- *Robustness details:* mask polarity is resolved from `getLabels()` at load
  (don't hard-code which confidence mask is "person"); masks are `close()`d
  every frame (MPMask wraps GPU memory — leaking it hangs the tab); model
  load failure degrades to plain passthrough exactly like before.
- *Picker UI:* Meet-style thumbnail grid — the gradient swatches ARE the
  backgrounds (CSS approximations of the canvas painters), custom photo via
  file input → object URL → `Image` handed through `setBackground(id, img)`.

**Chat window redesigned to the Slack/Teams reading model.**
- *What changed:* left/right chat bubbles → a flat, left-aligned message
  list. Consecutive messages from the same sender within 5 min **group**
  under one avatar+name header; grouped lines show their timestamp only on
  hover, in a gutter exactly as wide as the avatar (alignment is what makes
  grouping read cleanly). **Day dividers** ("Today" / "Yesterday" / date
  pills) replace scanning timestamps. Rows get a subtle hover wash; squared
  avatars (Slack's cue) distinguish chat from the circular presence
  avatars elsewhere.
- *Composer:* one bordered container with focus ring — emoji quick-picker
  (24 curated emoji, popover), borderless input with a "Message {room}"
  placeholder, and a gradient paper-plane send button that lights up only
  when there's something to send. Typing indicator is now three staggered
  bouncing dots (`animation-delay` inline — Tailwind can't stagger).
- *Grouping is computed at render, not stored:* `prev` message comparison in
  the map (same sender + <5 min + same day). No schema change, no migration,
  and history regroups correctly as messages stream in.
- *Bonus fix:* the Tailwind `brand` palette only defined 6 of 11 shades —
  existing classes like `brand-300`/`brand-800` were silently generating NO
  css (Tailwind won't warn). Completed the violet scale; several existing
  UI accents quietly came back to life.

**Interview takeaway:** replacing a feature is cheaper than building one if
the old feature was factored as pipeline + effect: `replaceTrack` plumbing,
lazy CDN loading, and the "never stop the raw track you don't own" rule all
carried over untouched — swapping face landmarks for segmentation masks was
a one-file change plus UI.

### Rich chat — emoji, GIFs, stickers, and file/image/video sharing
The chat looked like Slack after the last pass but could still only send
plain text. This pass made the message a *container* rather than a string.

**The schema decision that shaped everything.** `Message.text` was `required`.
Rather than inventing a parallel "attachment message" type, `text` became
optional, an `attachments[]` subdocument array was added, and a `pre("validate")`
hook enforces "text OR attachments, never neither". One collection, one
socket event, one render path — a photo with a caption is just a message
that has both. Attachment kinds: `image` · `video` · `audio` · `file` ·
`gif` · `sticker`.

**Upload flow: REST first, then socket.** The client POSTs files to
`/api/rooms/:id/attachments` (multer memory storage → straight to MinIO),
gets back descriptors, and only then emits ONE `message:send` carrying them.
Two reasons over streaming binary through Socket.io: the socket path stays
small and JSON-only, and a failed upload can never leave a half-written
message in the history. Progress comes free from axios' `onUploadProgress`.

**Why the socket re-validates what REST just produced.** The descriptors
travel through the *client*, so `message:send` treats them as hostile input
(`sanitizeAttachments`): uploads must have an origin matching our own
`S3_ENDPOINT`/`S3_PUBLIC_URL` — otherwise anyone could paste a third-party
URL and use the room as a link-laundering surface; GIFs must be https on a
known provider CDN host; stickers carry no URL at all (just a registry id, since the
art is vector code shipped with the client). Anything unrecognised is
**dropped silently while the text is kept** — a hostile attachment shouldn't
cost you your sentence. Live-verified: a `https://evil.example.com/x.png`
attachment was stripped and the message stored without it.

**Storage safety.** The public-read bucket policy was extended from
`avatars/*` to `chat/*`, and keys are `chat/<roomId>/<uuid><ext>` — random,
so the prefix is "public but unlisted" (the same trade-off Slack's own file
links make; signed URLs would be stricter but expire, which breaks durable
history). The user's filename never enters the key (path-traversal bait) —
only a sanitized extension. Non-media types get
`Content-Disposition: attachment` so nothing served from our own origin can
execute in a user's session; media stays `inline` so it renders in the
bubble. The MIME whitelist deliberately omits executables/scripts.

**Emoji: a hand-curated list, not a library.** Every npm emoji package ships
the full ~1,900-emoji set plus keyword indexes (300 KB–1 MB of JS). This is
~500 emoji people actually send, with search keywords, in a few KB — zero
dependencies, zero bundle hit, and it renders in the system font (no image
requests). 8 categories, substring search ranked prefix-matches-first, and a
localStorage "Recent" tray. Bonus: **jumbomoji** — a message that is only
emoji (≤3 graphemes) renders at 4xl with no bubble. Counting needs
`Intl.Segmenter`, because `"👨‍👩‍👧".length` is 8, not 1.

**GIFs — and the provider landscape collapsing mid-build.** The first pass
chose Tenor over Giphy (Giphy's free key is development-only, production is
paid and approval-gated). Then a check of the actual current state found the
bigger problem: **Google is discontinuing the Tenor API on 30 June 2026 and
stopped issuing new keys on 13 Jan 2026** — the chosen provider was not just
risky, it was already impossible to sign up for. Verified live, not from
memory: Tenor's anonymous v1 endpoint returns 401, Giphy's old public beta
key returns 403, and `api.waifu.pics` no longer resolves at all.

So the GIF source became **three layers, best-available-wins**, each
degrading into the next so the picker is never empty and never shows a broken
image:

1. **KLIPY** (`VITE_KLIPY_KEY`, optional) — full free-text search. Founded by
   ex-Tenor engineers with a near-identical API, free tier, no credit card,
   ads explicitly optional. WhatsApp migrated to it; Bluesky is following. It
   is the migration path the ecosystem actually took.
2. **OtakuGIFs** — **no key, no signup**, ~46 mapped reaction categories out
   of 70 upstream. This is what makes the feature work the moment you clone
   the repo, which the built-ins alone could not.
3. **Built-in SVG cards** — 24 generated animated reactions, no network.

Real GIFs are never re-hosted: the message stores the provider's CDN url, so
our storage bill for GIFs stays exactly zero.

*Two things this pass got right by refusing to guess:*
- The Klipy response parser **walks** the `files` object for the first
  plausible image url instead of hard-coding bucket names, because their docs
  host blocks crawlers and I could not verify the schema. Unknown shape → the
  item is skipped, never rendered broken.
- The backend GIF host whitelist mixes **verified exact hosts**
  (`cdn.otakugifs.xyz`, resolved live) with a **registrable-domain suffix
  rule** for Klipy, whose CDN subdomain is unknowable without a production
  key — `cdn.klipy.com` and `media.klipy.com` do not currently resolve, so
  listing either as a literal would have been another invented URL. The
  suffix match anchors on a dot, and tests prove `evilklipy.com`,
  `klipy.com.evil.net` and plain-http variants are all rejected.

*And one bug the verification caught before shipping:* the reaction map
included `think`, which is a **Gifukai** action, not an OtakuGIFs one —
searching "thinking" would have silently returned nothing. A test now reads
the reaction names straight out of `lib/gifs.js` and checks every one against
the live `/gif/allreactions` list (skipped offline so CI never fails on a
third party being down).

**The broken-thumbnail bug, and two wrong diagnoses before the right one.**
The picker showed broken/empty tiles in the grid while clicking a tile worked
perfectly. That combination already rules out dead URLs (a 404 fails both
ways) and CSP (there is none on the Vite-served page — checked).

*Wrong diagnosis #1 — payload size.* Measuring showed these are
full-resolution GIFs averaging ~500 KB, so an 18-tile grid was ~9 MB of
parallel requests; the obvious story was "browsers cap ~6 connections per
host, the rest stall". Fixes shipped on that theory: **WebP** instead of GIF
(same artwork, measured 68% smaller — `celebrate` 1,327 KB → 64 KB), shelf
18 → 12 tiles, and per-tile load states. Grid payload dropped 9 MB → 2.85 MB.
**The tiles were still blank.** The theory was plausible, the measurements
were real, and the conclusion was still wrong.

*Wrong diagnosis #2 — my own placeholder code.* Reading the shipped tile
found a genuine deadlock: `loading="lazy"` on an `<img>` that starts
`display:none` until `onLoad` fires. A lazy image that is `display:none` is
never near the viewport, so it is never fetched, so `onLoad` never fires, so
it stays hidden forever. Real bug, correctly fixed — **and still not why the
tiles were blank.**

*The actual cause, found by timing the failures in a real browser:* eleven of
twelve images failed in **~10 ms**. Instant failure is not a stalled queue and
not a big download — it is a refusal. Reproduced directly against the CDN:

    2 parallel requests  → 12/12 succeed
    3 parallel requests  →  8/12 succeed   (4 × HTTP 428)
    12 parallel requests →  1/12 succeeds  (11 × HTTP 428)

`cdn.otakugifs.xyz` has bot/abuse protection that answers **HTTP 428** above
~2 concurrent requests. A grid of `<img>` tags fires all of them at once, so
the grid could never work no matter how small the files were.

The fix is `lib/imageQueue.js`: a global loader that keeps at most **2**
requests in flight, staggers starts, and retries refusals with backoff. Tiles
mount their `<img>` only once the queue reports the url is cached, so the
render is instant and never re-hits the CDN. Verified in headless Chrome
against live urls: **all-at-once 1/12 in 10 ms, queued 12/12 in 1.13 s.**

*A near-miss worth recording separately:* the first WebP attempt **derived**
the webp url from the gif url by swapping `/gifs/`→`/webps/` and the
extension. All 12 test URLs 404'd — the two formats are independent random
draws with unrelated ids (`/gifs/wave/7832e5c7….gif` vs
`/webps/wave/967a5f2a….webp`). It only failed to ship because the check hit
real URLs.

**Lessons.** (1) *Timing is a diagnosis.* A failure at 10 ms and a failure at
10 s have completely different causes; measuring only "did it work" hides
that. (2) A plausible theory backed by real measurements can still be the
wrong theory — the payload numbers were all correct and irrelevant. (3) When
a symptom survives a fix, the fix was for a different bug; keep the fix if
it is genuinely right (WebP and the lazy/display:none deadlock both were),
but do not close the case.

**The fallback bug — and the rule that came out of it.** The first version
degraded (no key configured) to a "curated set of evergreen reaction GIFs"
that were hardcoded Tenor CDN urls. **Every single one 404'd.** A Tenor CDN
id is an opaque token you only get *from the API* — writing plausible-looking
ones from memory produces URLs that are syntactically perfect and completely
dead. Worse, the failure was invisible in code review: the array looked
right, lint passed, tests passed (nothing asserted the urls resolved), and
only clicking the tab revealed broken images. Search compounded it: with no
key, search filtered those 12 dead entries by label, so most terms returned
an empty panel.

The fix wasn't better urls — it was removing the external dependency from the
fallback path entirely. `lib/localGifs.js` generates **24 animated reaction
cards as inline SVG data URIs**: bouncing/pulsing emoji, a confetti rain, and
a typing-dots loop, each a few hundred bytes, animated with SMIL, impossible
to 404. Three behaviours were added at the same time, because "no results"
was the actual complaint: the shelf **shuffles** on every open, a 🎲 button
reshuffles on demand, and a search that matches nothing shows *"nothing for
X — here are some favourites"* over a full shelf rather than an empty box.
(The keyless OtakuGIFs layer above later slotted in *between* real search and
these cards, so the built-ins are now the third line of defence rather than
the second.)

*Storage/security note:* built-ins are persisted as `gifId` only, never the
data URI. Storing client-supplied SVG markup would be an XSS foothold — the
client re-renders the art from its own registry, and a test asserts the
backend whitelist and the frontend registry contain exactly the same ids
(two lists that drift silently would make picked GIFs vanish on send).

**Lesson worth keeping:** a fallback whose whole job is "work when the network
/ API is unavailable" must not itself depend on an unverifiable external URL.
And any asset list that can't be checked by the type system needs a test that
actually resolves it — I verified these 24 by decoding each data URI and
asserting it parses as animated SVG, which is exactly the check the original
Tenor urls never had.

**Stickers came free.** The six animated SVG stickers built for the games'
reaction system (`STICKERS` registry) were already vector components — the
chat sticker tab is a second consumer of that registry, and the message
renderer just mounts `<S.Comp size={104} />`. No new art, no assets.

**UI details that matter:** paste-to-upload (clipboard screenshots are the
#1 way people share an image), drag-and-drop with an overlay (using a
depth *counter*, not a boolean — drag events fire per child element and a
boolean flickers), staged thumbnails with per-file remove before sending,
multi-image messages tiling into a grid, a lightbox with download for
images/GIFs, native players for video/audio, and typed icon chips for
documents. Object URLs are tracked in a ref and revoked on unmount — the
classic blob leak.

**Verification:** 20 new backend tests (**255 total green**, up from 235) plus
live end-to-end scripts against the *running* server and MinIO — 19 checks
covering real upload → public fetch → byte-identical round-trip →
content-disposition → socket broadcast → durable history → hostile-URL
rejection, and 6 more for the built-in GIF id path. Every built-in reaction
card is validated by decoding its data URI and asserting well-formed,
animated SVG.

**Interview takeaway:** the security question in a file-sharing feature is
not "can I upload" but "what does the server *believe* the client". Uploading
over REST and then re-validating the descriptors at the socket boundary means
the trust decision lives in exactly one function, and the same rule protects
uploads, GIFs and stickers with three different policies.

### WhatsApp-grade chat — sticker studio, voice notes, view-once media
Three features, each riding rails that already existed.

**Stickers: 6 → 18, plus a studio.**
- Pack #2 is 12 new animated SVGs at a deliberately higher fidelity than pack
  #1: gradients and inner highlights so nothing reads flat, *secondary motion*
  (the rocket has exhaust and speed stars, the trophy has orbiting sparkles,
  the bulb flickers on a separate cycle from its rays), and easing via
  `keySplines` rather than linear interpolation. The old `gunshot` sticker was
  visibly flatter than the new work, so it was rebuilt too — gradient steel,
  wood grip, trigger guard, ejecting shell, smoke.
- *The id-collision trap:* every animation/gradient id is namespaced
  (`stk2-*`). Two SVGs on one page share a document, so a duplicate keyframe or
  gradient id silently hijacks the other sticker's animation. A check asserts
  all ids are namespaced and unique.
- *Save & favourite* (`lib/stickerStore.js`): ☆ pins a built-in to your
  favourites shelf, and ＋ on a received sticker copies it into your tray.
  Both live in localStorage — they are per-person UI preferences, not shared
  room state, so this needed **zero new endpoints and no migration**. The
  uploaded image itself is durable in MinIO; only the "this is in my tray"
  pointer is local.
- *Sticker studio* (`lib/stickerMaker.js`): photo → square crop (drag/zoom) →
  **background removed on-device** by the same MediaPipe selfie segmenter
  `bgFilter.js` already loads for call backgrounds → white outline + drop
  shadow → 512×512 PNG uploaded through the ordinary attachment endpoint. The
  outline is a cheap trick: draw the silhouette repeatedly at small offsets in
  white (`source-in` recolours the alpha), which dilates the shape without a
  per-pixel edge walk. If the model can't load, it offers the plain crop —
  a sticker with a background beats no sticker.

**Voice notes.** MediaRecorder (the API `lib/recorder.js` already uses for
calls) plus a WebAudio `AnalyserNode` for the live level meter. The peak array
captured *while recording* is downsampled to 48 bars and sent **in the message
document**, so the receiving bubble draws the real shape of the audio without
downloading and decoding the file first. Pause/resume tracks paused time
separately so the duration stays honest. Backend cost: zero new endpoints —
a voice note is `kind: "audio"` with `voice: true`.

**View-once media — enforced by the server, not the client.** A flag the
client could ignore would be theatre, so:
- the url is **stripped from the socket broadcast** entirely (otherwise any
  client could cache it forever);
- opening it is a `POST /messages/:id/view` that returns the url **exactly
  once per viewer** and records the view with `$addToSet` (idempotent under a
  double-tap race);
- the history endpoint runs `redactForViewer`, so a spent link can never come
  back out of `GET /messages`;
- `viewedBy` is server-owned — the sanitiser forces it to `[]` and never
  echoes it back, so the roster of who opened your photo never leaks;
- the **sender peeking does not consume the recipient's view**, but can't
  re-open it after someone else has.

**Deferred deliberately:** disappearing-message timers (24h/7d/30d/90d). The
right scope for them is a 1:1 DM, where both people opt in — a room-wide timer
set by one owner can destroy a group's shared history. Revisit when DMs land.

**Verification:** 267 tests green (up from 258). All 18 stickers were rendered
in headless Chrome and screenshotted — which caught two that looked wrong:
`party` was an empty box in a still frame (its confetti was mid-flight, so a
static spray was layered underneath the animated one), and `gunshot` looked
flat beside the new pack. Live end-to-end against the running server + MinIO:
13 checks covering voice upload → waveform persistence → view-once broadcast
redaction → first open 200 → second open 410 → history redaction.

**Interview takeaway:** "view once" is a *server* feature wearing a client
feature's clothes. Every one of the four leak paths (broadcast, history,
re-open, viewer roster) had to be closed independently — and the test that
proves it is the one asserting the second open returns 410, not the one
asserting the button disappears.

### Message actions, house rules, and call presence
Three features, all of which are really *permission* features wearing UI.

**Message actions — edit · copy · pin · forward · delete.** Every one is a
question of "who may do this to whose message", so the rules live in one
readable block in `chat.handlers.js` rather than scattered across handlers:
edit is author-only; delete-for-everyone is author **or room owner**
(moderation); pin is owner-only because the pin bar is a room-wide surface;
delete-for-me is anyone, affecting only their own view.

- *Delete for everyone is a **tombstone**, not a document removal.* The row
  stays with its text and attachments wiped. Two reasons: the conversation
  keeps its shape (grouping, day dividers and "X replied" don't reshuffle
  around a hole), and a deleted id can never be silently reused. History
  returns `deletedAt` and the client renders "🚫 This message was deleted".
- *Delete for me* is a per-user `hiddenFor` array filtered **at the query
  level**, so a hidden message never reaches the client that hid it — no
  client-side filtering to forget.
- *Editing only ever changes text.* Attachments are immutable, because an
  innocuous photo being swapped for something else after the fact is exactly
  the kind of trick an edit feature invites.
- *Forwarding is restricted to **public source rooms***, which is the one
  genuinely interesting rule here. A private room is a closed circle; letting
  its contents be re-broadcast elsewhere would make every private
  conversation quotable without consent. Public rooms are already open, so
  forwarding out of them leaks nothing. The forward also carries a
  `forwardedFrom` breadcrumb (original room + sender), so a forwarded message
  can't pass itself off as original — and **view-once media is stripped from
  a forward**, since re-sending it would be the obvious way to defeat it.

**House rules + explainable moderation.** The owner writes up to 20 rules;
every member can read them. `rules.updatedAt` versions the "please re-read"
prompt — the client stores the timestamp it acknowledged, so editing the rules
re-prompts everyone with **zero per-user rows in the database**. Kick and ban
now take a `reason`, and the kick dialog offers the house rules as a
numbered shortlist ("3" becomes "Rule 3: No spoilers"). The reason travels on
the `room:kicked` event, so the person removed is told *why* rather than just
vanishing from the room.

**Call presence — "N people are in this call · tap to join".** The mediasoup
peer map already knew who was connected; it just never told anyone. Attaching
identity to each peer makes a roster cheap to build, and `broadcastCallState`
sends it to the **whole room**, not just call participants — the people who
need the banner are precisely the ones *not* in the call. The roster arrives
two ways deliberately: a `call:state` broadcast on every join/leave, **and**
on the `room:join` ack, because otherwise a banner would only appear if
someone happened to join or leave while you were watching.

**Ring-to-invite (the Teams gesture).** `call:ring` is a **direct per-user
event**, not a room broadcast — the entire point is to reach someone who has
muted the room and would never see the banner. That's also why it's the one
notification allowed to bypass a mute, and why it is fenced: rate-limited to
6/minute, the caller must actually be in the call, and targets must already
be room members. Anyone with no live socket gets a Web Push instead, since an
explicit invite should reach you with the tab closed.

**Verification:** 282 tests green (up from 267 — 15 new), plus 20 live checks
against the running server covering every permission boundary: member can't
edit another's message, can't pin, can't set rules (403); owner *can* delete a
member's message; forward out of a private room is refused; delete-for-me
hides it from one person and not the other; the ban reason reaches both the
ban list and the `room:kicked` event.

*One test-harness lesson:* salting display names to avoid uniqueness
collisions broke two **existing** tests that asserted exact names
(`expect(cap.name).toBe("CapOwner")`). The fix was a separate `regUnique()`
helper rather than changing `reg()` for everyone — a shared test helper is an
API, and widening it silently is as breaking as changing production code.

### Room layout: an app shell, not a document
**The bug:** as messages arrived, the *page* grew and the whole document
scrolled — carrying the navbar, the Room/Board/Game tabs, the room name and
the Join call / Invite buttons off the top of the screen. Everything except
the message list was supposed to stay put.

Three causes, all of them the same mistake in different places:
- `min-h-screen` lets the page grow past the viewport. The fix is
  `h-screen` + `overflow-hidden` — the room is a fixed-height **app shell**,
  and exactly one element inside it (the message list) owns `overflow-y-auto`.
- `min-h-[70vh]` on the chat card made it stretch instead of fit.
- **Every flex ancestor of a scroll container needs `min-h-0`.** A flex item
  defaults to `min-height: auto`, which refuses to shrink below its content —
  so without it the "scroll container" simply grows and pushes the page
  taller, which is precisely the bug. This is the non-obvious one; the CSS
  looks correct without it.

The same reasoning applied outward: the Board and Game tabs now scroll
internally (the shell can no longer grow for them), the sidebar scrolls
independently so a long member list never drags the chat, and the in-call
video panel is capped at `max-h-[45%]` so screen shares plus camera tiles
can't squeeze the messages to nothing.

**Two bugs the screenshots caught that the assertions did not.** Verification
drove a real Chrome over CDP and asserted the header/composer `getBoundingClientRect().top`
was *identical* before and after scrolling the list (0 → 0 and 616 → 616,
page 704 = 704 so it cannot scroll). All green — but looking at the actual
image showed the floating VoiceBar sitting on top of the sidebar's "Delete
room" button, and on a 390px phone the header buttons overflowing the card
with the room name squeezed into a one-character-wide column. Neither is
expressible as "did the header move". Fixed by docking the bar bottom-right
(and hiding it on the Room tab while idle, where the header already has Join
call), and collapsing Invite/Copy-link to icons below `sm`.

**Lesson:** geometry assertions prove the thing you thought to measure.
Rendering the page and *looking at it* is what finds the overlap you did not
think to assert.

---

## 41. Architecture: Activity Platform — Phase 1 (plugin foundation)

**Goal.** Stop the app thinking in terms of built-in features. The room becomes a
core shell (chat · video · screen share · voice · presence · moderation) and
everything on the Board and Game surfaces becomes an **Activity Plugin**. Full
design in `docs/ACTIVITY_PLATFORM_MIGRATION.md`.

Phase 1 is the contract only: **no behaviour changes, nothing reads it yet.**

### What the analysis found

Better starting position than expected — two plugin-shaped things already worked:

- `sockets/lobbyGame.js` **is already a plugin framework**. Games supply pure
  callbacks (`start`, `publicState`, `botAct`, `tick`) and get
  `ctx = {g, io, roomId, broadcast, notice, endGame}` — they never touch
  Socket.IO directly. That is an SDK.
- `GamesHub.jsx` is a `GAMES[]` registry + `lazy()` panels.

But a measurement corrected an assumption. I claimed six games ran on the
framework; grepping for `createLobbyGame` showed **four** (chess 210, uno 237,
typing 149, bingo 212). **Ludo (536) and Kart (478) are bespoke** — they grew the
logic that *became* `lobbyGame.js` and were never moved onto it. Draw & Guess
(311) predates it. So the migration is three heavyweight conversions, not one.

Kart is hardest: it runs its own `setInterval` physics loop at `TICK_HZ`
(`kart.handlers.js:248`). Migrates last; its `destroy()` is the reference
lifecycle test.

**The actual coupling problem:** adding one game today means editing four files
that have nothing to do with that game — `sockets/index.js` (12 hardcoded
registrations), `RoomPage.jsx:546` (literal tab array), `RoomPage.jsx:31-44`
(`ACT_LABEL`/`ACT_VIEW` maps), `GamesHub.jsx:28` (`GAMES[]`).

### Options considered

| Decision | Options | Chosen — why |
|---|---|---|
| Is chat a plugin? | (a) everything is a plugin (b) chat stays core | **(b)** — chat is the room's substrate: games post into it, moderation acts on it, it survives activity switches, it is the fallback when a plugin fails. As a plugin it could be *uninstalled*, bricking the room. Plugins use `sdk.chat` instead. |
| Where do manifests live? | (a) duplicate per side (b) `shared/` (c) fetch from API | **(b)** — the wizard, the engine and the server's permission check need the same facts; two copies drift. Data-only ESM, no build step. |
| Registry contents | (a) manifests + components (b) manifests only | **(b)** — registering components pulls every plugin into the initial bundle and destroys existing lazy loading (Excalidraw ~1.8 MB). |
| Config grammar | (a) JSON Schema (b) closed 6-type grammar | **(b)** — JSON Schema can express what no form can render (`oneOf`, `$ref`, recursion), so a generic renderer silently drops fields. Closed grammar ⇒ every valid schema renders; an unrenderable one is a boot error. |
| Backward compat | (a) migration script (b) read-time resolver | **(b)** — absence means "everything". No batch job, no deploy ordering, no downtime, fully reversible; rooms upgrade themselves on first edit. |
| Permissions | (a) check at call time (b) build SDK from declared list | **(b)** — an ungranted capability is `undefined`, so it fails as a TypeError at the plugin's own call site in dev, not in production in someone else's frame. **Absent beats denied.** |

### Implementation

```
shared/                          ← new, data-only, imported by BOTH sides
  package.json                   ("type":"module" — see gotcha below)
  activities/
    manifest.js                  contract + validateManifest() + CAPABILITIES
    config-schema.js             6-type grammar + validate + coerce (trust boundary)
    registry.js                  register/get/byCategory/bySurface/deps + cycle detection
    purposes.js                  10 wizard cards
    compat.js                    legacy resolution — the backward-compat core
    index.js                     registers the 9 built-ins; auto-runs on import
    <id>/manifest.js             whiteboard skribbl ludo chess uno typing bingo kart poll
```

Plus: `Room` gains `activities.installed[]`, `activities.active`, `purpose`, and
`visibility` gains `inviteOnly`; `backend/src/index.js` imports the registry
first so a bad manifest crashes at boot; Vite gets an `@shared` alias.

**v1 SDK is five capabilities** — `room:read`, `socket:namespaced`,
`storage:room`, `presence:read`, `events:listen`. Narrowing the scope to
whiteboard + games cut it from ten: nothing in scope needs chat, video or AI.
A test pins this list so adding one is a deliberate decision.

### Challenges

**1. `shared/` was parsed as CommonJS.** Jest failed with *"Cannot use import
statement outside a module"*. Node resolves module type from the **nearest**
`package.json` walking up from each file — `shared/` is a sibling of `backend/`,
so backend's `"type": "module"` never applied. Fix: a 6-line `package.json` in
`shared/`.

**2. Duplicate `server:` key in `vite.config.js`.** I added `fs.allow` as a new
`server` block while one already existed. Valid JS — the second silently wins —
so `fs.allow` would have been dropped and dev imports from `shared/` would break
with a confusing "outside of Vite serving allow list". Caught by reading the
file back after editing. **Merging into an existing key is not the same as
adding a key.**

**3. Invented config options that did not exist.** I wrote kart arenas
`arena`/`docks`/`canyon` from memory; the real `MAPS` are `speedway`, `forest`,
`volcano`, `circuit`, `canyon` — only one right. Same for typing
(`difficulty`/`passageLength` — the real modes are `race`/`timed`) and bingo
(invented 2/4/7s; the ticker is `ms: 3500`). A manifest describes config the
plugin will honour, so inventing settings *creates* work rather than describing
it. **Same failure mode as the dead Tenor URLs — plausible-looking values I did
not check.** Fixed by grepping each handler.

**4. A test that failed for a real reason.** "Every purpose recommends
something" failed on **music** — there is no music plugin yet. Tempting fix:
add a fake `music: 0.3` weight somewhere. That would lie to the engine and put
Bingo in front of someone who asked for music. Instead the gap is named
(`PURPOSES_WITHOUT_PLUGINS`) with a second test asserting it is the *only* one,
so shipping Music Room **fails** the suite as a reminder to delete the
exemption.

**5. Proving the Vite alias actually worked.** First attempt built a probe file
that was never imported — Rollup tree-shakes it, so the green build proved
nothing. Second attempt used a marker string, which Vite constant-folded away.
What finally proved it: grepping `dist/` for real manifest content
(`"Smash Karts 3D"`, `infiniteCanvas`), plus a live `curl` of
`/@fs/.../shared/activities/purposes.js` returning 200 from the dev server —
build path and dev path use different mechanisms (bundler vs `fs.allow`).

### Verification

- **77 new contract tests**, all green.
- **Full suite: 18 suites / 359 tests green** — the 282 pre-existing tests
  untouched, which is the actual claim being made ("no behaviour changes").
- Backend log: `✅ 9 activity plugins registered` on real boot.
- Vite prod build contains manifest data; dev server serves `shared/` (200).
- **Real Mongo document** shaped like a pre-plugin room: loads through Mongoose,
  resolves to all 9 activities at defaults, `active: null`, and `inviteOnly`
  passes validation. Probe row deleted afterwards.

Note: Mongoose materializes a missing array as `[]`, not `undefined` — which is
why `resolveInstalled()` tests `.length > 0` rather than existence. A unit test
alone would not have shown that; it took a real document.

### Interview Q&A

**Q: Why isn't chat a plugin if "everything except the room" should be?**
Because uninstalling it would brick the room. Chat is the substrate the other
activities post into and the fallback when a plugin fails to load. The rule:
*if removing it bricks the room, or if two plugins would fight over the same
hardware (mediasoup's SFU router), it's infrastructure.* VS Code doesn't make
the text buffer an extension.

**Q: Why a resolver instead of a migration?**
A backfill must be re-run for every deploy and every row written by an older
server, is a deploy-ordering hazard, and is hard to undo. A read-time resolver
means old rooms behave identically with zero rows touched, and dropping the
field returns the app to its starting state.

**Q: Why not JSON Schema for plugin config?**
Expressiveness is the wrong goal for a schema that must be *rendered*. JSON
Schema can describe forms no generic renderer can draw, and the failure is
silent — the setting vanishes. Six types means every valid schema renders, and
an invalid one fails loudly at boot.

**Q: How do you know adding a plugin won't break the app?**
Six mechanisms, not conventions: adding a plugin edits no existing file; error
boundary per plugin; manifests validate at boot; unknown ids degrade to a
placeholder instead of white-screening; ESLint `no-restricted-imports` confines
plugins to the SDK; `destroy()` is mandatory. Phase 6 tests guarantee #1 for
real — building Sticky Notes must touch nothing outside its own folder.

**Q: What was the most expensive mistake here?**
Writing manifest values from memory instead of reading the handlers. Three of
nine manifests had fabricated options. It's the same failure as the dead Tenor
URLs earlier in the project: plausible-looking output that was never checked
against the thing it describes.

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

**Done — Whiteboard (§21):** collaborative Excalidraw in rooms.
**Done — Draw & Guess game (§22)** and **Ludo (§23):** two mini-games in a
games hub, both server-authoritative + responsive, live-verified.

**Done — Activity social layer (feature-map F21):** Skribbl **ready-up lobby**
(host starts only when 2+ all ready), **activity notifications** (tap-to-join
toasts when someone starts a call/board/game), and **mic on every tab**
(audio-only "Join voice" + a persistent VoiceBar). Verified: ready-up gate.

**Next:**
0. **Direct messages (1:1)** — the prerequisite for disappearing-message
   timers (24h/7d/30d/90d), which belong in a two-person conversation both
   parties opt into rather than a room-wide switch one owner controls.
1. **Friends system** (requests, friends list, invite friends to a room/activity) —
   the one deferred item; a standalone persistent subsystem, its own build.
2. **Manual browser tests** across all activities (2 tabs) + guest link.
3. **Responsive pass** polish; watch-party (synced YouTube); rename (French, TBD).
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
| GIF search (chat) | Giphy paid production plan (and Tenor's API shuts down 30 Jun 2026) | **KLIPY** free tier (`VITE_KLIPY_KEY`, no credit card) → **OtakuGIFs** (no key at all) → 24 **self-generated animated SVG** cards (`lib/localGifs.js`). Real GIFs are never re-hosted, so storage cost is zero |

*Last updated: 2026-08-06 (message actions — edit/copy/pin/forward/delete — house rules with explainable moderation, live "N in call" banner, and Teams-style ring-to-invite that reaches muted members — 282 tests green. Disappearing-message timers still deferred to DMs.)*
