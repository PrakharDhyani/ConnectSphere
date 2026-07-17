# Feature Map — every feature in one fixed template

> One entry per feature, always the same shape:
>
> **Tool & technology** → what's used (each defined in [Part 0](part-0-technologies.md))
> **What needs to be done** → the goal, in plain words
> **How it's done** → the approach we chose (and what we rejected)
> **Workflow** → the step-by-step flow when it runs
> **File by file** → every file the feature touches (deep dives in [Part 2](part-2-backend-auth.md))
>
> Interview stories & Q&A for each live in [PROJECT_NOTES.md](../PROJECT_NOTES.md).

---

## F1. Infrastructure — Docker Compose

**Tool & technology:** Docker, Docker Compose, MongoDB 7, Redis 7.2, ZooKeeper,
Kafka (Confluent 7.6), Kafka UI, MailDev.

**What needs to be done:** run all backing services locally, identically on any
machine, without installing anything natively — and be able to wipe/reset in one
command.

**How it's done:** one `docker-compose.yml` declaring six containers with
healthchecks (so dependents wait for *ready*, not just *started*), named volumes
(data survives restarts), one bridge network (containers reach each other by
service name). Rejected: native installs (version drift, painful cleanup) and
cloud dev services (cost/latency for no gain).

**Workflow:**
1. `docker compose up -d`
2. Docker starts mongo/redis/zookeeper/maildev in parallel; each runs its healthcheck loop
3. Kafka waits for `zookeeper: service_healthy`, then starts; kafka-ui waits for Kafka
4. Backend (on the host) connects to everything via `localhost:<port>`
5. Reset anytime: `docker compose down -v`

**File by file:**
- [docker-compose.yml](../../docker-compose.yml) — the whole thing; dissected in [Part 1 §2](part-1-foundations.md)

---

## F2. Backend scaffold

**Tool & technology:** Node 20, Express, helmet, cors, express-rate-limit,
cookie-parser, morgan + winston, dotenv, ESLint 9.

**What needs to be done:** a skeleton API where every request flows through a
deliberate middleware pipeline, all config comes from env, errors end up in one
handler, and logs are structured.

**How it's done:** `app.js` (build the app) split from `index.js` (boot
connections + listen) — so tests can import the app without a server. Middleware
installed in dependency order; one central error handler consumes every
`next(error)`; winston JSON logs with daily rotation.

**Workflow (every request, forever):**
```
request → helmet → cors → rate-limit → body parse → cookie parse → passport
        → logging → matching route → (404 if none) → error handler → response
```

**File by file:**
- [src/index.js](../../backend/src/index.js) — boot order: env → Mongo → Redis → Kafka → HTTP+Socket.io → listen ([Part 2 §1](part-2-backend-auth.md))
- [src/app.js](../../backend/src/app.js) — the pipeline above ([Part 2 §1](part-2-backend-auth.md))
- [src/config/mongo.js](../../backend/src/config/mongo.js) / [redis.js](../../backend/src/config/redis.js) / [kafka.js](../../backend/src/config/kafka.js) — one shared connection each ([Part 2 §2](part-2-backend-auth.md))
- [src/middleware/errorHandler.js](../../backend/src/middleware/errorHandler.js) + [notFound.js](../../backend/src/middleware/notFound.js) — uniform error envelope ([Part 2 §4](part-2-backend-auth.md))
- [src/utils/logger.js](../../backend/src/utils/logger.js) — winston setup ([Part 2 §3](part-2-backend-auth.md))
- [src/sockets/index.js](../../backend/src/sockets/index.js) — Socket.io stub ([Part 2 §8](part-2-backend-auth.md))

---

## F3. User model & password hashing

**Tool & technology:** Mongoose (schema, indexes, hooks), bcrypt.

**What needs to be done:** a single source of truth for identity, storing
passwords so that even a stolen database doesn't reveal them.

**How it's done:** bcrypt (slow-by-design, salted, cost 12) in a `pre("save")`
hook — hashing is automatic on every save path, impossible to forget. Hash is
`select: false` (never leaves default queries). `googleId` is `unique+sparse` so
password-only users can omit it. Rejected: plaintext (never), fast hashes
(GPU-crackable), argon2 (fine too; bcrypt won on ubiquity + Windows friction).

**Workflow (any code saves a user with a new password):**
1. `user.save()` → pre-save hook fires
2. `isModified("password")`? → bcrypt-hash (~250ms) → stored
3. Login later: `.select("+password")` → `user.comparePassword(candidate)` → true/false

**File by file:**
- [src/models/User.js](../../backend/src/models/User.js) — everything above ([Part 2 §5](part-2-backend-auth.md))

---

## F4. JWT authentication — register & login

**Tool & technology:** jsonwebtoken (JWT), Joi, express-rate-limit, cookies
(httpOnly), ms.

**What needs to be done:** email/password signup and login that issue a session
the SPA can use — fast to verify, safe if stolen, revocable.

**How it's done:** hybrid session model — 15-min stateless **access token**
(JSON body → frontend memory) + 7-day **refresh token** (httpOnly `SameSite=Lax`
cookie, tracked in Redis). One shared `issueTokens()` so every path issues
identically. Joi validation at the edge; identical 401 for wrong-password vs
unknown-email (anti-enumeration); stricter rate limit (20/15min). Rejected: pure
server sessions (DB hit per request), pure JWT (unrevocable), localStorage
tokens (XSS-readable).

**Workflow (login):**
1. `POST /api/auth/login` → authLimiter → `validate(loginSchema)`
2. Controller: `findOne({email}).select("+password")` → `comparePassword`
3. Any failure → the same generic 401
4. Success → `issueTokens()`: sign access JWT + refresh JWT (with fresh `jti`) → store jti in Redis → `Set-Cookie: refreshToken=…; HttpOnly`
5. Response: `{user (safe fields), accessToken}` — SPA keeps the token in memory

**File by file:**
- [src/utils/token.js](../../backend/src/utils/token.js) — sign/verify, jti, single TTL source ([Part 2 §3](part-2-backend-auth.md))
- [src/validators/auth.validator.js](../../backend/src/validators/auth.validator.js) — schemas, shared password rule ([Part 2 §5](part-2-backend-auth.md))
- [src/middleware/validate.js](../../backend/src/middleware/validate.js) — Joi → 400 / cleaned `req.body` ([Part 2 §4](part-2-backend-auth.md))
- [src/controllers/auth.controller.js](../../backend/src/controllers/auth.controller.js) — `register`, `login`, `issueTokens`, `toSafeUser` ([Part 2 §6](part-2-backend-auth.md))
- [src/routes/auth.routes.js](../../backend/src/routes/auth.routes.js) — wiring + authLimiter ([Part 2 §7](part-2-backend-auth.md))

---

## F5. Auth middleware & protected routes

**Tool & technology:** JWT verification, Express per-route middleware.

**What needs to be done:** let any route require a logged-in user and know who's
calling.

**How it's done:** `authenticate` middleware parses `Authorization: Bearer`,
verifies the access token, attaches `req.user = {id, role}`. All failure modes →
one generic 401 (details only help attackers). Routes opt in explicitly.

**Workflow (`GET /api/users/me`):**
1. Request arrives with `Authorization: Bearer <access token>`
2. `authenticate`: header present & well-formed? signature valid? not expired?
3. Fail → 401 · Pass → `req.user` set → `getMe` loads the user → safe-fields JSON (404 if deleted)

**File by file:**
- [src/middleware/authenticate.js](../../backend/src/middleware/authenticate.js) ([Part 2 §4](part-2-backend-auth.md))
- [src/controllers/user.controller.js](../../backend/src/controllers/user.controller.js) — `getMe` ([Part 2 §6](part-2-backend-auth.md))
- [src/routes/user.routes.js](../../backend/src/routes/user.routes.js) — `router.get("/me", authenticate, getMe)`

---

## F6. Refresh-token rotation & logout

**Tool & technology:** Redis (SET with TTL, GETDEL, sets), JWT `jti` claim,
crypto.randomUUID.

**What needs to be done:** make the 7-day token revocable (real logout) and
single-use (a stolen token dies on first legitimate refresh — and the theft is
detectable).

**How it's done:** **allowlist** in Redis — a refresh token is honored only if
`refresh:<jti>` still exists and belongs to the same user. Refresh consumes the
old jti (atomic GETDEL) and issues a new pair. Logout deletes the jti +clears
the cookie (idempotent). A per-user Redis *set* of jtis (`user_sessions:<id>`)
enables "revoke everything." Rejected: blacklist (unbounded, only helps after
you know it's stolen), short TTL + forced relogin (bad UX).

**Workflow (refresh):**
1. `POST /api/auth/refresh` — browser auto-attaches the cookie
2. Verify JWT signature → extract `jti`, `sub`
3. Redis: does `refresh:<jti>` exist and equal this user? No → 401 (rotated/revoked/stolen-and-late)
4. GETDEL it (single-use, atomically) → `issueTokens()` → new access token + new cookie

**File by file:**
- [src/services/refreshToken.service.js](../../backend/src/services/refreshToken.service.js) — store/check/revoke/revoke-all ([Part 2 §5](part-2-backend-auth.md))
- [src/utils/token.js](../../backend/src/utils/token.js) — jti embedded at signing
- [src/controllers/auth.controller.js](../../backend/src/controllers/auth.controller.js) — `refresh`, `logout`

---

## F7. Google OAuth 2.0

**Tool & technology:** OAuth 2.0 authorization-code flow, Passport
(`passport-google-oauth20`), Google Cloud Console (consent screen + credential).

**What needs to be done:** "Sign in with Google" — identity proven by Google, no
password ever seen by us, sessions still fully ours.

**How it's done:** passport strategy with `session: false`; find-or-create with
**account linking** (same email → link googleId to the existing account rather
than duplicate — safe because Google verified the email). Token hand-off avoids
putting anything in the redirect URL (history/log leak): set the refresh cookie
server-side, redirect to the SPA, SPA calls `/refresh`. Degrades to 501 when
creds aren't configured.

**Workflow:**
1. Browser hits `GET /api/auth/google` → 302 to Google's consent screen
2. User consents → Google 302s back to `/google/callback?code=…`
3. Passport exchanges code + client secret for the profile (server-to-server)
4. Find-or-create: by googleId → by email (link) → create new (`emailVerified: true`)
5. `issueTokens()` sets the refresh cookie → redirect to `CLIENT_URL/auth/callback`
6. SPA calls `POST /refresh` → gets its access token

**File by file:**
- [src/config/passport.js](../../backend/src/config/passport.js) — strategy + find-or-create ([Part 2 §2](part-2-backend-auth.md))
- [src/routes/auth.routes.js](../../backend/src/routes/auth.routes.js) — `/google`, `/google/callback`, 501 guard
- [src/controllers/auth.controller.js](../../backend/src/controllers/auth.controller.js) — `googleCallback`

---

## F8. Email verification & password reset

**Tool & technology:** crypto (randomBytes, SHA-256), Redis (TTL + GETDEL),
nodemailer, MailDev.

**What needs to be done:** prove users own their email; let locked-out users
recover via an emailed link — without the links being forgeable, reusable, or a
way to probe which emails are registered.

**How it's done:** high-entropy random token emailed raw; Redis stores only its
SHA-256 hash (`verify_email:` 24h / `reset_password:` 1h) → a Redis leak exposes
nothing usable. GETDEL = single-use. Sending is best-effort (mail hiccup never
fails registration). Forgot/resend always answer the same generic 200. Reset
also revokes **all** sessions (the "I may be compromised" path) via the F6
reverse index. Rejected: JWT-as-link-token (can't single-use; secret leak forges
links), storing raw tokens (leak = live tokens).

**Workflow (reset):**
1. `POST /forgot-password` → generic 200 either way; if the account exists: token created, hash stored in Redis (1h), link emailed → lands in MailDev (`localhost:1080`)
2. User opens `CLIENT_URL/reset-password?token=…` (frontend form — user must type a new password)
3. `POST /reset-password {token, password}` → SHA-256(token) → GETDEL in Redis → miss = 400
4. Save new password (hook hashes) → `emailVerified: true` → `revokeAllUserSessions` → every old refresh cookie is now dead

**File by file:**
- [src/services/authToken.service.js](../../backend/src/services/authToken.service.js) — hash-at-rest one-time tokens ([Part 2 §5](part-2-backend-auth.md))
- [src/services/email.service.js](../../backend/src/services/email.service.js) — transport + templates ([Part 2 §5](part-2-backend-auth.md))
- [src/controllers/auth.controller.js](../../backend/src/controllers/auth.controller.js) — `verifyEmail`, `resendVerification`, `forgotPassword`, `resetPassword`
- [docker-compose.yml](../../docker-compose.yml) — the `maildev` service

---

## F9. Automated test harness

**Tool & technology:** Jest, supertest, mongodb-memory-server, hand-written
Redis fake, ESM module mocking.

**What needs to be done:** re-verify the entire auth surface on every change in
seconds, with zero infrastructure (`npm test` must work on any machine/CI).

**How it's done:** integration style — supertest drives the real `app` (real
middleware/routes/controllers/models); only the *edges* are replaced: in-RAM
Mongo, 8-command Redis fake, email spies that capture the outgoing links so
tests extract real one-time tokens. Rate limiters skip under `NODE_ENV=test`.
Rejected: containers-in-CI (slow, flaky), pure unit tests (mock exactly the
wiring where auth bugs live).

**Workflow (one test run):**
1. `npm test` → Jest under `--experimental-vm-modules`
2. Harness: set env → register ESM mocks → boot memory-Mongo → import app → sync indexes
3. Each test: wiped collections + flushed fake Redis + cleared email capture
4. supertest fires requests → assertions on status/body/cookies/Mongo/Redis state
5. 37 tests, 5 suites, ~15s, no Docker

**File by file:**
- [jest.config.js](../../backend/jest.config.js) — ESM setup, coverage scope ([Part 2 §9](part-2-backend-auth.md))
- [tests/helpers/harness.js](../../backend/tests/helpers/harness.js) — env, mocks, lifecycle, cookie helpers
- [tests/helpers/fakeRedis.js](../../backend/tests/helpers/fakeRedis.js) — the 8-command fake
- [tests/health.test.js](../../backend/tests/health.test.js) · [auth.register-login.test.js](../../backend/tests/auth.register-login.test.js) · [auth.tokens.test.js](../../backend/tests/auth.tokens.test.js) · [auth.email-verify-reset.test.js](../../backend/tests/auth.email-verify-reset.test.js) · [users.me.test.js](../../backend/tests/users.me.test.js) — what each proves: [Part 2 §9](part-2-backend-auth.md)

---

## F10. Auth UI — frontend ✅

**Tool & technology:** React 18, react-router, zustand, axios (interceptors),
react-hook-form + zod, Tailwind.

**What needs to be done:** the browser half of auth — register/login forms,
staying logged in across reloads, protected pages, Google button, and the
verify/reset landing pages the backend already redirects to.

**How it's done:** access token in a zustand store (**memory only** — never
localStorage), refresh via the httpOnly cookie the backend already sets; axios
interceptors attach the token to every request and silently `/refresh`-and-retry
on 401 (**single-flight**: parallel 401s share one refresh call, because refresh
tokens are single-use); on app boot one silent refresh restores the session;
`<ProtectedRoute>` shows a spinner during bootstrap (never flash the login page
at a logged-in user), then renders or bounces to `/login`. zod schemas mirror
the backend's Joi rules for instant field errors — UX only, the server still
enforces everything.

**Workflow (page reload while logged in):**
1. App boots → store is empty (memory was wiped)
2. `bootstrapAuth()`: `POST /api/auth/refresh` — browser attaches the cookie automatically
3. Valid → new access token into the store → `GET /users/me` → user into the store → status `authed`
4. Invalid → status `guest` → protected routes bounce to `/login`

**Workflow (access token expires mid-session):**
1. Any API call → 401
2. Response interceptor: not an /auth/ URL, not retried yet → call `/refresh` (single-flight)
3. New token stored → original request retried with it → caller never sees the 401
4. Refresh itself fails → `clearAuth()` → user is logged out for real

**File by file:**
- [src/stores/auth.store.js](../../frontend/src/stores/auth.store.js) — `{user, accessToken, status}` + set/clear; readable outside React (`getState()`)
- [src/lib/api.js](../../frontend/src/lib/api.js) — the axios instance, both interceptors, `refreshAccessToken` (single-flight), `bootstrapAuth`
- [src/components/ProtectedRoute.jsx](../../frontend/src/components/ProtectedRoute.jsx) — spinner while `loading`, `<Navigate to="/login">` for guests
- [src/components/ui/](../../frontend/src/components/ui/) — `Input` (forwardRef for react-hook-form), `Button`, `AuthCard` (shared centered layout)
- [src/pages/LoginPage.jsx](../../frontend/src/pages/LoginPage.jsx) — form + Google link (`<a href="/api/auth/google">` — full-page redirect, OAuth can't be a fetch); shows reset-success + oauth-error messages
- [src/pages/RegisterPage.jsx](../../frontend/src/pages/RegisterPage.jsx) — zod mirror of the backend password policy; logged in immediately on success
- [src/pages/AuthCallbackPage.jsx](../../frontend/src/pages/AuthCallbackPage.jsx) — post-Google landing: runs bootstrap, routes to dashboard or `/login?error=oauth`
- [src/pages/EmailVerifiedPage.jsx](../../frontend/src/pages/EmailVerifiedPage.jsx) — reads `?status=` from the backend redirect
- [src/pages/ForgotPasswordPage.jsx](../../frontend/src/pages/ForgotPasswordPage.jsx) / [ResetPasswordPage.jsx](../../frontend/src/pages/ResetPasswordPage.jsx) — the reset pair (`?token=` from the email)
- [src/pages/DashboardPage.jsx](../../frontend/src/pages/DashboardPage.jsx) — first protected page: user card, verify-email banner + resend, logout
- [src/App.jsx](../../frontend/src/App.jsx) — all routes + the one-time `bootstrapAuth()` effect
- [src/pages/HomePage.jsx](../../frontend/src/pages/HomePage.jsx) / [NotFoundPage.jsx](../../frontend/src/pages/NotFoundPage.jsx) — linked up (NotFound was an **empty file** that crashed the build — found & fixed)
