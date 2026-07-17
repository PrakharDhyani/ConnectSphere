# Part 2 — Backend, file by file (boot → auth → tests)

> **How to read this:** top to bottom follows the life of the server — how it boots,
> how a request flows through it, then every module in the order a request meets
> them, then the test suite. Each file gets: *what it is → why it exists → how it
> works → gotchas*. Newbie-level; jargon explained on first use.

**The request pipeline (memorize this — everything below hangs off it):**

```
request → helmet → cors → rate-limit → body parsers → cookie-parser → passport
        → logging → routes (validate → authenticate → controller → services → model)
        → 404 → error handler → response
```

---

## 1. Boot & the app object

### [src/index.js](../../backend/src/index.js) — the entry point

**What:** the file `npm run dev` / `npm start` actually executes. It *starts* things;
it defines no routes or logic.

**How it works, line by line:**
1. `import "dotenv/config"` — loads `.env` into `process.env` **first**, before any
   other import runs (imports execute top-to-bottom; several modules read env at
   import time, so order matters here).
2. `bootstrap()` connects, **in order**: Mongo → Redis → Kafka. Only after all
   three succeed does it start the HTTP server. This is *fail-fast*: if Redis is
   down you find out at boot, not when the first user tries to log in.
3. `http.createServer(app)` — Express alone could listen, but Socket.io needs a
   raw Node HTTP server to attach to, so we create one wrapping the Express app —
   both share port 5000.
4. `initSocket(httpServer)` — attaches Socket.io (a stub for now, see §8).
5. `httpServer.listen(PORT)` — finally accept traffic.
6. A `SIGTERM` handler logs and exits — that's the signal Docker/k8s send on stop.

**Why split index.js from app.js?** So tests (and anything else) can import the
configured `app` **without** starting a server or connecting to Kafka. This one
decision is what makes the whole test harness possible.

### [src/app.js](../../backend/src/app.js) — building the Express app

**What:** creates the Express application and installs every piece of middleware,
in a deliberate order (middleware = functions that each request passes through,
like an assembly line — **order is behavior**).

The order and why:

1. **`helmet()`** — sets ~15 security response headers (X-Frame-Options against
   clickjacking, nosniff, etc.). First, so even error responses carry them.
2. **`cors({origin: CLIENT_URL, credentials: true})`** — tells browsers "the
   frontend origin may call me and may include cookies." (Dev traffic mostly rides
   the Vite proxy instead — see Part 1 §5.)
3. **Global rate limiter** — 300 requests / 15 min / IP. A brake against abuse.
   `skip: () => NODE_ENV === "test"` — in tests every request comes from the same
   loopback IP and would trip the limit with spurious 429s (see §9).
4. **`express.json()` / `express.urlencoded()`** — parse request bodies into
   `req.body`. Before this runs, `req.body` doesn't exist.
5. **`cookieParser()`** — parses the `Cookie` header into `req.cookies`; how the
   refresh endpoint reads the httpOnly refresh token.
6. **`configurePassport()` + `passport.initialize()`** — registers the Google
   OAuth strategy (§3) and mounts passport's plumbing.
7. **morgan → winston** — HTTP access logging, funneled into our structured logger
   instead of raw console.
8. **`GET /api/health`** — liveness probe: returns `{status:"ok", uptime}`.
   Deliberately *before* auth — monitoring must never need a login.
9. **Routers:** `/api/auth`, `/api/users`, `/api/rooms` (§7).
10. **`notFound` then `errorHandler`** — LAST, so anything no route matched falls
    into the 404, and every `next(error)` from anywhere lands in one place (§4).

---

## 2. `config/` — connections to the outside world

### [config/mongo.js](../../backend/src/config/mongo.js)

Connects **mongoose** (an ODM — Object Document Mapper: lets us define schemas
and call `User.findOne(...)` instead of hand-writing Mongo queries) to
`MONGO_URI`. Registers listeners for `connected` / `error` / `disconnected` so
connection state is visible in logs. `serverSelectionTimeoutMS: 5000` = fail after
5s instead of hanging forever if Mongo is down.

### [config/redis.js](../../backend/src/config/redis.js)

Creates **one** Redis client (`node-redis` v4, promise-based) that the whole app
shares via `export { redisClient }` — Node caches modules, so every importer gets
the *same* client (a singleton). Includes a reconnect strategy: exponential
backoff, capped at 5s, give up after 10 tries. Used by the refresh-token and
one-time-token services (§5).

### [config/kafka.js](../../backend/src/config/kafka.js)

Sets up a KafkaJS **producer** (the thing that *sends* messages to Kafka topics).
Exports `publishToKafka(topic, message, key)` — the key matters later: messages
with the same key (e.g. `roomId`) land in the same partition, which preserves
their order. No feature publishes yet; this is plumbing for the recording/
notification pipelines. (kafkajs prints a benign `TimeoutNegativeWarning` at
connect — known quirk, deliberately ignored.)

### [config/passport.js](../../backend/src/config/passport.js)

**What:** registers the Google OAuth *strategy* — the piece that handles "Sign in
with Google."

**The flow (know this cold):** browser → `/api/auth/google` → redirect to Google →
user consents → Google redirects back to our callback with a one-time **code** →
passport exchanges code + our client *secret* (server-side only!) for the user's
profile → our callback below decides what that profile means in OUR database →
we issue OUR OWN JWTs. Google only proves identity; sessions stay ours.

**The find-or-create logic (3 steps, in order):**
1. `User.findOne({googleId})` → returning Google user.
2. Else `User.findOne({email})` → an existing password account with the same
   email: **link it** (set `googleId`, mark `emailVerified: true`) instead of
   creating a duplicate. Safe *because* Google verified the email first.
3. Else create a brand-new user with `emailVerified: true`.

**Graceful degradation:** if `GOOGLE_CLIENT_ID/SECRET` aren't set, the strategy
simply isn't registered — boot logs a warning and the `/google` routes return a
clear `501` instead of passport's cryptic "Unknown strategy" crash. Dev stays
bootable with zero setup.

---

## 3. `utils/` — small shared helpers

### [utils/logger.js](../../backend/src/utils/logger.js)

**Structured logging** with winston: logs are JSON objects (machine-searchable by
Loki/CloudWatch), not `console.log` strings. Three transports (destinations):
colorized console (dev), a daily-rotating `logs/connectsphere-*.log` (kept 14
days), and a separate errors-only file (kept 30 days). Levels:
`http < debug < info < warn < error`.

### [utils/token.js](../../backend/src/utils/token.js)

Everything JWT. A **JWT** (JSON Web Token) is `header.payload.signature` — the
signature is an HMAC of header+payload with a server secret, so anyone can *read*
a token (it's just base64 — never put secrets in the payload!) but nobody can
*forge* one without the secret.

- `buildPayload(user)` → `{sub: user id, role}` — minimal by design (`sub` =
  "subject", the standard claim for "who this token is about").
- `generateAccessToken(user)` — signed with `JWT_ACCESS_SECRET`, expires in 15m.
- `generateRefreshToken(user)` — different secret, 7d, and embeds a **`jti`**
  (JWT ID — a random UUID naming this specific token) returned separately so the
  caller can track it in Redis (§5). Two secrets means a leaked access secret
  still can't forge refresh tokens.
- `verifyAccessToken` / `verifyRefreshToken` — `jwt.verify` checks the signature
  AND expiry; throws on any problem.
- `REFRESH_TOKEN_TTL_SECONDS` — parsed once from `JWT_REFRESH_EXPIRES_IN` via the
  `ms` package, then reused for the JWT, the cookie Max-Age, *and* the Redis TTL —
  one source of truth, three expiries that can never drift apart.

---

## 4. `middleware/` — the reusable request-pipeline pieces

### [middleware/errorHandler.js](../../backend/src/middleware/errorHandler.js)

The **one place** errors become HTTP responses. Any controller/middleware does
`error.statusCode = 409; next(error)` and this converts it to
`{success: false, error: {message}}` with that status (default 500). Express
recognizes it as an error handler purely because it has **4 parameters**
`(err, req, res, next)`. In production it hides message+stack for 500s (stack
traces leak internals). Because of this file, controllers stay thin — they never
build error responses themselves.

### [middleware/notFound.js](../../backend/src/middleware/notFound.js)

Mounted after all routes: if execution reaches it, nothing matched → build a 404
error and `next(error)` it into the errorHandler. Uniform error shape everywhere.

### [middleware/validate.js](../../backend/src/middleware/validate.js)

A **higher-order function**: `validate(schema)` *returns* a middleware for that
Joi schema. Checks `req.body`; on failure collects **all** problems
(`abortEarly: false`) into one 400. On success replaces `req.body` with the
cleaned value — `stripUnknown: true` silently drops fields we didn't ask for, so
a malicious `{"role": "admin"}` in a register payload never reaches the
controller. Controllers can trust `req.body` completely.

### [middleware/authenticate.js](../../backend/src/middleware/authenticate.js)

Turns "valid access token" into `req.user`. Reads `Authorization: Bearer <token>`,
verifies it, attaches `{id, role}`, calls `next()`. Every failure mode — missing
header, malformed header, bad signature, expired — returns the **same generic
401**: the client's remedy is identical in every case ("refresh or log in
again"), and detailed errors would only help attackers. Routes opt in per-route:
`router.get("/me", authenticate, getMe)` — explicit and greppable.

---

## 5. `models/`, `validators/`, `services/` — the layers under controllers

### [models/User.js](../../backend/src/models/User.js) — the User schema

Fields: `name`, `email` (unique, lowercased), `password`, `googleId`, `avatarUrl`,
`role` (`user`/`admin`), `emailVerified`, plus automatic `createdAt`/`updatedAt`.

The four clever bits:

1. **`password: {select: false}`** — default queries **never** return the hash;
   login explicitly opts in with `.select("+password")`. Defense-in-depth: a
   careless `res.json(user)` anywhere else physically can't leak it.
2. **`googleId: {unique: true, sparse: true}`** — `sparse` lets many documents
   *omit* the field; a plain unique index would treat all the missing values as
   duplicates of each other and reject the second password-only user.
3. **Hashing in a `pre("save")` hook** — before every save, if the password
   changed, bcrypt-hash it (cost 12 ≈ 250ms). Because it's on the model, *no code
   path can forget to hash*. Why bcrypt? It's **deliberately slow** with a
   built-in per-password salt — a leaked hash costs the attacker ~250ms/guess
   instead of billions/sec with SHA-256. Cost 12 balances security vs login UX.
4. **`comparePassword` instance method** — bcrypt is encapsulated here;
   controllers never import bcrypt.

`password` is *not* required at schema level — Google users legitimately have
none; the register validator enforces it at the edge instead.

### [validators/auth.validator.js](../../backend/src/validators/auth.validator.js)

Joi schemas consumed by `validate()`: `registerSchema` (name 2–100, valid email,
password rule), `loginSchema` (email + any password — we're checking a hash, not
enforcing policy), `emailSchema` (forgot-password / resend), `resetPasswordSchema`
(token + password rule). The password rule (min 8, upper+lower+digit) is **one
shared constant** so register and reset can never drift apart.

### [services/refreshToken.service.js](../../backend/src/services/refreshToken.service.js)

**The problem it solves:** JWTs are stateless — you can't "delete" one. So how do
logout and stolen-token protection work? **Allowlist**: a refresh token is only
honored if its `jti` currently exists in Redis. Delete the key → token dead.

- `storeRefreshToken(jti, userId)` — `SET refresh:<jti> = userId` with TTL equal
  to the JWT's own life (Redis auto-deletes at expiry — no cleanup cron ever).
  Also `SADD user_sessions:<userId> ← jti` — a **reverse index**: "all sessions
  of this user," which is what lets password-reset kill everything at once.
- `getRefreshTokenOwner(jti)` — who was this issued to, or `null` = not valid.
- `revokeRefreshToken(jti)` — `GETDEL` (atomic read-and-delete: no race window
  between checking and deleting) + remove from the user's set.
- `revokeAllUserSessions(userId)` — read the set, delete every `refresh:` key,
  delete the set.

*Why allowlist over blacklist?* A blacklist of revoked tokens grows unboundedly
and only helps after you *know* a token is stolen. The allowlist is bounded by
active sessions, auto-cleans via TTL, and **fails closed**: Redis miss = rejected.

*Known wrinkle:* Redis sets have no per-member TTL, so `user_sessions` could hold
stale jtis whose `refresh:` keys already expired. Mitigated: the set carries the
same TTL (refreshed per new token) and revocation tolerates missing keys.

### [services/authToken.service.js](../../backend/src/services/authToken.service.js)

One-time tokens for **email verification** (24h TTL) and **password reset** (1h).

The design (interview gold):
- `crypto.randomBytes(32)` → 256 bits of randomness, hex-encoded, emailed to the
  user **raw**.
- Redis stores only `SHA-256(token) → userId`. If Redis ever leaks, the dump
  contains hashes of tokens — nothing usable.
- *Why is fast SHA-256 fine here when passwords need slow bcrypt?* Because the
  token is already 256 random bits — there's nothing to brute-force. bcrypt's
  slowness exists to protect *low-entropy* secrets (human passwords).
- `consumeToken` uses **`GETDEL`** — atomically fetch-and-delete, so every token
  is single-use and two racing requests can't both redeem it.

### [services/email.service.js](../../backend/src/services/email.service.js)

One **nodemailer** transport (SMTP connection), configured 100% from env, created
lazily on first use. Dev → MailDev container (catches everything at
`localhost:1080`, delivers nothing). Prod → point `SMTP_*` at Resend/Brevo — zero
code change. Two exported helpers build the actual HTML: `sendVerificationEmail`
and `sendPasswordResetEmail`. Callers treat sending as **best-effort** — a mail
hiccup must never fail a registration (there's `/resend-verification`).

---

## 6. `controllers/` — where HTTP meets logic

### [controllers/auth.controller.js](../../backend/src/controllers/auth.controller.js)

Every handler follows the same shape: `try { ... } catch (e) { next(e) }` — all
errors flow to the central errorHandler.

**Shared helpers at the top (the design in miniature):**
- `issueTokens(res, user)` — generate access + refresh pair, store the refresh
  `jti` in Redis, set the cookie, return the access token. Register, login,
  refresh, and the Google callback all call this **one** function → tokens are
  issued identically everywhere.
- The cookie options: **`httpOnly`** (page JS can't read it → XSS can't steal
  it), **`sameSite: "lax"`** (browser won't attach it to cross-site POSTs →
  bounds CSRF; fine here because `localhost:3000/5000` are the same *site* —
  SameSite ignores ports), **`secure` in prod** (HTTPS only).
- `toSafeUser(user)` — the exact whitelist of fields responses may contain.
  Never the hash, never internals.
- `dispatchVerificationEmail(user)` — create one-time token, email the link.

**The endpoints:**

| Handler | The important detail |
|---|---|
| `register` | 409 if email exists → create (model hashes) → `issueTokens` → verification email **best-effort** (try/catch — mail failure ≠ registration failure) → 201. |
| `login` | `.select("+password")` → `comparePassword`. Unknown email, Google-only account, wrong password → the **identical** `401 "Invalid email or password"`. Any difference would make login an *email-enumeration oracle* (a way to probe which emails have accounts). |
| `refresh` | The rotation dance: verify JWT signature → **check the `jti` is still in Redis and owned by the same user** → delete it (single-use!) → issue a brand-new pair. A stolen cookie that was already rotated → the jti is gone → 401. That's **theft detection** — proved live by copying the cookie jar and replaying it. |
| `googleCallback` | Runs after passport resolved the user. It's a full-page redirect (not fetch), so no JSON body to put a token in — and a token in the redirect URL would persist in browser history/logs. So: set only the refresh cookie → redirect to `CLIENT_URL/auth/callback` → the SPA calls `/refresh` for its access token. |
| `verifyEmail` | GET (it's a link click) → `consumeVerificationToken` → set `emailVerified` → redirect to frontend with `?status=success/invalid`. Reuse of a consumed token → invalid (single-use holds). |
| `resendVerification` | Only sends for an existing *unverified* account — but responds the same generic 200 **always** (no oracle). |
| `forgotPassword` | Same anti-enumeration 200 whether or not the email exists. Reset link points at the **frontend** (`/reset-password?token=…`) because the user must type a new password into a form (unlike verify, which needs no input and can hit the backend directly). |
| `resetPassword` | Consume token → set new password (hook hashes) → `emailVerified = true` (clicking the emailed link proves ownership) → **`revokeAllUserSessions`** — reset is the "I may be compromised" path; every existing session must die. |
| `logout` | Revoke the cookie's jti, clear the cookie. Succeeds even with a dead/absent token — **idempotent**: the end state ("logged out") is what matters. |

### [controllers/user.controller.js](../../backend/src/controllers/user.controller.js)

`getMe` — first consumer of `authenticate`: `User.findById(req.user.id)` → 404 if
deleted → safe-fields JSON. The pattern every protected endpoint will follow.

---

## 7. `routes/` — wiring URLs to handlers

### [routes/auth.routes.js](../../backend/src/routes/auth.routes.js)

Reads as a table of the API. Note the per-route middleware chains — e.g.
`router.post("/register", authLimiter, validate(registerSchema), register)` —
each request runs the chain left-to-right.

- **`authLimiter`** — a *stricter* limit (20/15min vs global 300) on register,
  login, refresh, resend, forgot, reset — these are brute-force targets. (Also
  test-skipped, §9.)
- **Google routes** — both guarded by `requireGoogleConfigured` (the 501
  fallback). `/google` starts the redirect; `/google/callback` runs
  `passport.authenticate` (code→profile exchange + find-or-create) and then
  `googleCallback`. `failureRedirect` sends a declined consent back to
  `/login?error=oauth` on the frontend.
- Everything auth-related, including `verify-email`, lives here.

### [routes/user.routes.js](../../backend/src/routes/user.routes.js)

Just `GET /me` behind `authenticate` for now; profile endpoints will join it.

### [routes/room.routes.js](../../backend/src/routes/room.routes.js)

A one-line placeholder answering "coming in Phase 3" — exists so `app.js` can
mount `/api/rooms` today without a dead import later.

---

## 8. [sockets/index.js](../../backend/src/sockets/index.js) — Socket.io stub

Attaches a Socket.io server to the HTTP server with CORS for the frontend origin
and logs connect/disconnect. **Why Socket.io over raw WebSocket?**
auto-reconnection, rooms/namespaces built in, proxy-friendly, long-polling
fallback. Real handlers arrive with chat/rooms; keeping the stub means `index.js`
wiring is already correct.

---

## 9. The test suite (`tests/` + jest.config.js) — how it verifies all of the above

**Philosophy:** integration tests over unit tests. supertest drives the **real
`app`** — real routing, middleware order, validation, cookies, controllers,
models — with only the *edges* replaced. Auth bugs live in the wiring, so that's
what we test. And `npm test` needs **zero infrastructure**: no Docker, no Redis,
no SMTP.

```
jest.config.js            ESM setup, coverage scope, 30s timeout
tests/
├── helpers/
│   ├── fakeRedis.js      in-memory Redis with exactly our 8 commands
│   └── harness.js        env + mocks + in-memory Mongo + app import + cleanup
├── health.test.js               health, 404 envelope, Google-501
├── auth.register-login.test.js  register + login (happy & sad paths)
├── auth.tokens.test.js          refresh rotation, theft detection, logout
├── auth.email-verify-reset.test.js  verify, resend, forgot, reset
└── users.me.test.js             authenticate middleware, /users/me
```

### [jest.config.js](../../backend/jest.config.js)

The project is native ESM, which Jest doesn't fully support out of the box. Three
settings make it work: the test script runs
`node --experimental-vm-modules node_modules/jest/bin/jest.js` (enables ESM in
Jest's VM; works on Windows and CI alike), `transform: {}` (disables Babel — run
files as real ESM), and `testTimeout: 30000` (first run downloads/boots the
in-memory Mongo binary). `collectCoverageFrom` excludes what tests deliberately
don't cover: the boot file, sockets stub, kafka glue, logger config.

### [tests/helpers/fakeRedis.js](../../backend/tests/helpers/fakeRedis.js)

A ~40-line object with the **exact** command surface our services call: `set`
(with `{EX}`), `get`, `getDel`, `del`, `sAdd`, `sRem`, `sMembers`, `expire` —
backed by a `Map` and a `Map` of `Set`s. TTLs are accepted but not enforced
(nothing asserts wall-clock expiry; JWT expiry is tested via `expiresIn`
instead). *Why hand-write it?* We use node-redis v4's promise API; most mock
libraries target ioredis. Eight commands = a fake we fully understand beats a
mismatched dependency.

### [tests/helpers/harness.js](../../backend/tests/helpers/harness.js)

The heart of the suite. In order:

1. **Env at module top level** — secrets/TTLs/URLs are set *before* any app code
   loads, because `token.js` computes values at import time. Google creds are
   *deleted* so OAuth is predictably "not configured."
2. **Three ESM mocks** via `jest.unstable_mockModule`:
   redis → the fake; email service → spies that **capture `{to, url}` into an
   array** (so a test can extract the real one-time token from the link — the
   MailDev workflow reduced to an array); logger → silenced (also prevents
   winston's file handles keeping the process alive).
3. **`beforeAll`:** boot `MongoMemoryServer` (a real `mongod` in RAM), connect
   mongoose, **then** dynamically `import()` the app — the import must come after
   the mocks are registered, which is exactly why we use `unstable_mockModule` +
   dynamic import instead of the classic hoisted `jest.mock()`. Then
   `User.syncIndexes()` materializes the unique/sparse indexes so duplicate-email
   tests behave like production.
4. **`beforeEach`:** wipe every collection (keeping indexes), flush the fake
   Redis, clear captured emails → every test starts pristine, order-independent.
5. **Cookie helpers** — `getRefreshCookie` (the `name=value` pair to send back)
   and `getRefreshSetCookie` (full header, for asserting `HttpOnly` etc.).

**The bug we hit here (worth remembering):** passing a *relative* path to
`unstable_mockModule` failed with "Cannot find module" — Jest resolves the
specifier against **the test file that's running**, not the helper that calls it.
Fix: build **absolute** paths from `import.meta.url`. Same id from anywhere.

### What each test file proves

- **health.test.js** — `/api/health` 200; unknown route → 404 in the standard
  error envelope; `/api/auth/google` → 501 without creds.
- **auth.register-login.test.js** — register: 201 + access token + `HttpOnly`
  cookie + safe user (no password field!), verification email captured, duplicate
  → 409, weak password/bad email/missing fields → 400. Login: happy path; wrong
  password and unknown email produce **byte-identical** 401s (anti-enumeration).
- **auth.tokens.test.js** — refresh rotates (new cookie ≠ old); **theft
  detection** (replay a pre-rotation cookie after a legit refresh → 401, while
  the rotated-to cookie still works); no/garbage cookie → 401; logout clears the
  cookie, kills the token, and is idempotent.
- **auth.email-verify-reset.test.js** — extract the token from the captured
  email link → verify → `emailVerified: true` in Mongo → **reuse → invalid**;
  resend/forgot always answer the same generic 200 and only actually email real
  (and, for resend, unverified) accounts; reset: new password logs in, old
  doesn't, **all pre-reset sessions are revoked**, invalid token → 400.
- **users.me.test.js** — the authenticate matrix: valid → 200; no header /
  `Token x` / garbage / wrong-secret-signed / **expired** (manufactured with
  `expiresIn: "-10s"` — no waiting 15 minutes) → 401; valid token whose user was
  deleted → 404.

**37 tests, 5 suites, ~15s.** Coverage where it matters: controllers ~90%,
token/refresh/one-time-token services, validators, and auth middleware 100%.
Uncovered = the mocked edges (redis/email transport) and the Google browser
round-trip — that path was proven live (PROJECT_NOTES §10).

### Running

```powershell
cd backend
npm test          # full suite
npm run test:cov  # + coverage table
npm run test:watch
```
