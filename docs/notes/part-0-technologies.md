# Part 0 — Every Technology, Explained From Zero

> **Assume I know nothing.** That's the rule for this file. Every tool, library,
> and acronym in ConnectSphere gets: **what it is** (plain English + an analogy),
> **why this project needs it**, and **where exactly we use it**.
> Read this before Parts 1–3; they assume the vocabulary defined here.

---

## 0. The absolute basics (read once, everything else builds on this)

**Client and server.** Two programs talking over a network. The *client* asks
(your browser); the *server* answers (our backend). In ConnectSphere: the React
app in the browser is the client, our Node/Express program is the server.

**HTTP.** The language of that conversation. A client sends a **request** —
a *method* (GET = give me, POST = here's data, PUT/PATCH = change, DELETE =
remove), a *URL path* (`/api/auth/login`), optional *headers* (metadata like
"I'm sending JSON" or "here's my ID badge") and a *body* (the data). The server
sends back a **response**: a *status code* + body. Status codes you'll see
constantly:

| Code | Meaning | Example in our app |
|---|---|---|
| 200 / 201 | OK / Created | login succeeded / user registered |
| 302 | Redirect ("go to this other URL") | email-verify link bounces you to the frontend |
| 400 | Bad request (your data is invalid) | weak password |
| 401 | Unauthorized (who are you?) | wrong password, expired token |
| 404 | Not found | unknown URL |
| 409 | Conflict | email already registered |
| 429 | Too many requests | rate limit hit |
| 500 | Server error (we crashed) | a bug |
| 501 | Not implemented | Google login without credentials configured |

**JSON.** The data format everything speaks:
`{"name": "Prakhar", "age": 25}` — human-readable text that maps directly to
JavaScript objects. Our API takes JSON in and returns JSON out.

**API (Application Programming Interface).** The *menu* of requests a server
understands. `POST /api/auth/register`, `GET /api/users/me` … Each menu item is
an **endpoint**. A "REST API" just means the menu is organized around nouns
(users, rooms) and the standard HTTP verbs.

**Ports and localhost.** One machine runs many servers; a **port** number picks
which one gets the message — like apartment numbers in one building.
`localhost` = "this same machine." So `localhost:5000` = "the program listening
on port 5000 on my own laptop." Our map: React dev server :3000, Express :5000,
MongoDB :27017, Redis :6379, Kafka :9092.

**Environment variables (env vars).** Named values a program reads from its
surroundings at startup (`process.env.PORT`) instead of having them written in
the code. Why: secrets must never be typed into code (code goes to GitHub;
secrets must not), and dev/production need different values (local DB vs cloud
DB) with zero code changes. The `.env` file holds them; `dotenv` loads it.

---

## 1. Runtime & language layer

### Node.js
**What:** JavaScript was born as a browser-only language. Node.js is a program
that runs JavaScript *outside* the browser — on servers. One language for
frontend and backend is the whole reason the "MERN" stack exists.
**Why we chose it:** ideal for apps that juggle thousands of simultaneous
lightweight connections (chat, video signaling) because of its *event loop* —
one fast worker handling many waiting tasks, instead of one thread per user.
**Where:** everything in `backend/` runs on Node 20.

### npm and `package.json`
**What:** npm = Node's package manager — installs libraries ("packages") others
have written. `package.json` = the project's manifest: which packages, which
versions, plus **scripts** (`npm run dev`, `npm test` are just named shell
commands). `package-lock.json` pins *exact* versions so every machine installs
identical code. `node_modules/` is where packages physically live (huge,
regenerable, never committed to git).
**Versions:** `^4.19.2` means "4.19.2 or any newer 4.x" — major version bumps
(5.0) can break things, so they're never automatic.

### ES Modules (ESM)
**What:** JavaScript's official import system: `import x from "y"` /
`export function z`. The older Node style was CommonJS (`require()`). Our
`"type": "module"` in package.json opts the whole project into ESM.
**Why it matters:** modern standard, but some tools (Jest!) still need special
flags to handle it — that bit us; see Part 2 §9.

---

## 2. Backend framework

### Express
**What:** the most-used Node web framework. Raw Node gives you "a request
arrived"; Express gives you routing (`app.get("/path", handler)`), request/
response helpers, and **middleware**.
**Middleware — the one Express concept you must own:** an assembly line. Every
request passes through a chain of functions; each can inspect it, change it,
reject it, or pass it on (`next()`). Security headers, body parsing, logging,
authentication — all middleware, all order-dependent. Our exact chain is
documented in Part 2 §1.
**Where:** the entire API — `backend/src/app.js` builds the app, routes live in
`backend/src/routes/`.

### The layered structure we use on top of Express

```
routes/      → URL → which functions run, in what order
middleware/  → reusable request-pipeline pieces (auth check, validation…)
controllers/ → one function per endpoint: read request, call services, respond
services/    → business logic that talks to Redis/email/etc. (no HTTP knowledge)
models/      → data shapes + database access
validators/  → schemas that define what valid input looks like
config/      → connections to external systems (DB, Redis, Kafka, Google)
utils/       → small shared helpers (logger, JWT signing)
```

Why bother? Each layer is testable and swappable on its own; a controller never
needs to know *how* Redis stores a token, only that `storeRefreshToken()` does it.

---

## 3. Databases & storage

### MongoDB — the primary database
**What:** a database stores data permanently (RAM is wiped on restart; disk
survives). MongoDB is a **document database**: it stores JSON-like objects
("documents") in "collections" — versus SQL databases (MySQL/Postgres) which
store rows in tables with rigid columns.
**Analogy:** SQL = a spreadsheet with fixed columns. Mongo = a filing cabinet of
JSON files.
**Why Mongo here:** our data *is* JSON (users, rooms, messages flow as JSON from
browser to API), the schema evolves fast during development, and it's the M in
MERN.
**Where:** users (later: rooms, messages, recordings). Runs in Docker on :27017.

### Mongoose — the ODM
**What:** ODM = Object Document Mapper — a library that sits between our code and
MongoDB. We define a **schema** (User has `name: String, email: unique...`), get
back a **model** (`User`), and call `User.findOne({email})` instead of writing
raw database commands. It also runs **hooks** (code before/after saves — our
password hashing lives in one) and **validations**.
**Where:** `backend/src/models/User.js`, connected in `config/mongo.js`.

### Redis — the fast, temporary store
**What (from zero):** Redis is a database that keeps ALL data **in RAM**, which
makes reads/writes ~100× faster than a disk database — but it's meant for data
you can afford to lose or that expires anyway. It's a **key-value store**: you
`SET key value` and `GET key` — like one giant super-fast dictionary shared by
all your servers. It also has small data structures (lists, **sets** — we use a
set), publish/subscribe channels, and — its killer feature for us — **TTL**
(time-to-live): attach an expiry to a key and Redis deletes it automatically.
**Analogy:** Mongo is the filing cabinet (permanent records); Redis is the
whiteboard next to your desk (instant to read/write, wiped when stale).
**Why we need it:** the refresh-token system (Part 2 §5). Each login stores
`refresh:<token-id> → user-id` with a 7-day TTL. Logout = delete the key.
"Session expired" = Redis deleted it for us — no cleanup job ever needed. Later:
caching room state and scaling Socket.io across servers.
**Where:** `config/redis.js` (connection), `services/refreshToken.service.js`
and `services/authToken.service.js` (all actual usage). Docker, :6379.

### Kafka — the event pipeline (plumbing today, used later)
**What (from zero):** Kafka is a **message queue** — a system where one program
drops messages ("events") and other programs pick them up *later*,
*independently*. Programs that write are **producers**; programs that read are
**consumers**; the named channels they use are **topics** (like folders:
`call.events`, `notifications`). Two properties make Kafka special vs simpler
queues: messages are **persisted to disk and replayable** (a consumer that
crashed can re-read from where it stopped — or from the beginning), and it
handles enormous throughput.
**Analogy:** a conveyor belt with memory. Producers put boxes on; consumers take
them off at their own pace; the belt keeps a copy of every box for 24h (our dev
setting), so a new worker can replay the day.
**Why a video app needs it:** heavy work must not block a live call. Recording a
call means processing video chunks with ffmpeg and uploading them — seconds of
work. Instead of doing that during the request, the backend drops a
"chunk received" event on Kafka in ~1ms and a separate consumer does the slow
work. Same for notifications and analytics.
**Why not just Redis pub/sub?** Redis pub/sub is fire-and-forget — if no one is
listening at that instant, the message is gone forever. Kafka persists. Different
jobs: Redis = fast ephemeral state; Kafka = durable ordered event log.
**Where:** `config/kafka.js` sets up a producer (`publishToKafka(topic, msg)`).
No feature publishes yet — it's ready for the recording pipeline. Docker, :9092.

### ZooKeeper — Kafka's coordinator
**What:** Kafka is designed to run as a *cluster* of several servers
("brokers"). Something has to track which brokers are alive, who's the leader,
and where topics live — that bookkeeper is ZooKeeper, a separate small service.
**Analogy:** the office manager who keeps the org chart; Kafka brokers do the
actual work.
**Do we care about its internals?** No — it exists purely because our Kafka
image requires it. (Newer Kafka has "KRaft mode" with no ZooKeeper.) It cost us
a debugging war story (healthcheck — Part 1 §2) and that's all.
**Where:** docker-compose only. :2181.

### MinIO — file storage (next feature)
**What:** databases are wrong for big binary files (videos, avatars). "Object
storage" — Amazon S3 being the famous one — stores files in "buckets" behind an
API. **MinIO** is a free, self-hostable server that speaks S3's exact protocol,
so we code against the official AWS SDK (`@aws-sdk/client-s3`, already
installed) while running MinIO in Docker for free. Swap env vars → real S3/R2 in
prod, zero code change. (Free-tier rule: PROJECT_NOTES §"No Paid Cloud Services".)
**Where:** avatars in the profiles feature, recordings later.

---

## 4. Authentication & security (the heart of what we've built so far)

### Hashing and bcrypt — storing passwords
**What hashing is:** a one-way math function: input → fixed-size scrambled
output. Same input → same output, but there's no way *back*. We store only the
hash of your password; at login we hash what you typed and compare.
**Why not SHA-256 (a normal hash)?** It's *designed to be fast* — a GPU tries
billions of guesses/second against a leaked hash. **bcrypt** is *deliberately
slow* (we tuned it to ~250ms per attempt, "cost 12") and bakes in a **salt** — a
random per-password value — so two users with the same password get different
hashes and precomputed "rainbow tables" are useless.
**Where:** `models/User.js` pre-save hook + `comparePassword`.

### JWT — the ID badge
**What:** JSON Web Token — a string `header.payload.signature`. The payload is
readable JSON (user id, role, expiry). The **signature** is computed from the
payload + a server-only secret; change one character of the payload and the
signature no longer matches. So: anyone can *read* a JWT, **no one can forge or
alter** one without the secret.
**Analogy:** a tamper-evident wristband — the venue reads it at every door
without calling the ticket office (no DB lookup per request — this is why JWTs
scale), but the holographic seal proves the venue itself issued it.
**The catch:** you can't un-issue one. A JWT is valid until it expires, period.
Which forces the next design…

### Access token + refresh token — our session model
Two tokens with different jobs (issued on register/login/refresh):
- **Access token — 15 minutes.** Sent as the `Authorization: Bearer <token>`
  header on every API call. Pure JWT, verified by signature alone — fast. If
  stolen, useless in ≤15 min.
- **Refresh token — 7 days.** Only used to mint a new access token. This one is
  ALSO tracked server-side: its unique id (**jti** claim) must exist in Redis
  (the **allowlist**). Delete the Redis key → token dead. That's how logout and
  "log out everywhere" work despite JWTs being unrevokable.
- **Rotation:** each refresh *consumes* the old token (single-use) and issues a
  new one. Stolen-and-already-rotated token → its jti is gone → 401. Theft is
  not just prevented, it's *detectable*.

### Cookies, httpOnly, and where tokens live in the browser
**What a cookie is:** a small piece of data the server asks the browser to keep
(`Set-Cookie` header); the browser automatically re-attaches it to every future
request to that site. **httpOnly** = a cookie page-JavaScript *cannot read* —
only the browser's networking layer sees it.
**Our split and why:** the refresh token rides an httpOnly cookie (so
XSS — malicious injected JS — can't steal it), while the access token lives in a
JS variable in memory (never `localStorage`, which any XSS can read). `SameSite=Lax`
on the cookie means the browser won't attach it to requests started by *other*
sites — which blunts **CSRF** (a hostile page silently firing requests at our
API using your cookies).

### OAuth 2.0 + Passport — "Sign in with Google"
**What OAuth is:** a protocol for "prove who you are via an account you already
have, without giving us your password." The dance: we redirect you to Google →
you consent there → Google redirects back with a one-time **code** → our server
(never the browser) exchanges code + our **client secret** for your profile →
we find-or-create you in OUR database and issue OUR OWN tokens. Google is only
the identity check; sessions stay ours.
**Passport** = the Node library that implements those dances as pluggable
"strategies"; we use `passport-google-oauth20`.
**Where:** `config/passport.js` (the strategy + find-or-create/account-linking),
`routes/auth.routes.js` (`/google`, `/google/callback`).

### The supporting security cast
- **helmet** — middleware that sets ~15 protective HTTP headers (anti-
  clickjacking, MIME-sniffing, …). One line, free hardening.
- **CORS** — browsers block a page on origin A from calling API on origin B
  unless B explicitly allows it. The `cors` middleware is us allowing exactly
  our frontend. (In dev the Vite proxy sidesteps this — Part 1 §5.)
- **express-rate-limit** — caps requests per IP (300/15min global, 20/15min on
  auth endpoints) so password-guessing and abuse get throttled.
- **crypto** (built into Node) — `randomBytes(32)` for unguessable one-time
  tokens, `randomUUID()` for jtis, SHA-256 for hashing those tokens at rest.
- **Anti-enumeration** (a principle, not a package): login/forgot/resend always
  answer identically whether or not the email exists — otherwise the API becomes
  a machine for discovering who has an account.

### Joi — input validation (backend)
**What:** every endpoint's first duty is "is this input even sane?" Joi lets us
declare a **schema** — "email: required, valid email; password: min 8, must have
upper+lower+digit" — and our `validate()` middleware checks `req.body` against
it, rejects with 400 listing *all* problems, and **strips unknown fields** (a
sneaky `"role": "admin"` never reaches the controller).
**Where:** `validators/auth.validator.js` + `middleware/validate.js`.
(Frontend forms will use **zod** — same idea, React-ecosystem native.)

---

## 5. Email

### SMTP, nodemailer, MailDev
**SMTP** = the decades-old protocol for sending mail — you hand your message to
an SMTP server and it delivers. **nodemailer** = the standard Node library for
speaking SMTP (one "transport" configured from env). **MailDev** = a fake SMTP
server in Docker for development: it *accepts* everything and *delivers
nothing* — every "sent" email just appears in a web inbox at `localhost:1080`.
Free, offline, and no risk of accidentally emailing a real address. In
production we point the same code at a real provider (Resend/Brevo free tier)
by changing env vars only.
**Where:** `services/email.service.js`; used by register (verification link),
resend-verification, forgot-password (reset link).

---

## 6. Real-time layer (stub today, core of the product later)

### WebSocket & Socket.io
**The problem:** HTTP is request→response; the server can't spontaneously push
"new message arrived" to a browser. **WebSocket** fixes that: one connection
that stays open, both sides send whenever they like.
**Socket.io** = WebSocket plus the production conveniences: auto-reconnect,
"rooms" (broadcast to everyone in room X), fallbacks for networks that block
WebSocket. Client library (`socket.io-client`) is already in the frontend.
**Where:** `sockets/index.js` — connection logging only, until chat/rooms.

### WebRTC & mediasoup (the video engine — future)
**WebRTC** = the browser's built-in tech for sending live audio/video
peer-to-peer. Fine for 2 people; breaks down for groups (everyone uploading to
everyone). **SFU** (Selective Forwarding Unit) = a server everyone sends *one*
stream to, which forwards to the others — that server is **mediasoup** (a Node
library, already in package.json). **TURN** (self-hosted coturn later) relays
media when strict firewalls block direct paths.
**Where:** nothing yet — Phase 3. Knowing the words is enough for now.

---

## 7. Infrastructure & dev tooling

### Docker & Docker Compose
**What Docker is:** software shipped in **containers** — sealed boxes carrying
the app plus everything it needs, running identically on any machine. An
**image** is the frozen recipe (`mongo:7.0`); a **container** is a running copy.
**Compose** = one YAML file declaring all our containers, their ports, health
checks, and disk **volumes** (named storage that survives container restarts);
`docker compose up -d` starts the whole zoo.
**Why:** installing Mongo+Redis+Kafka+ZooKeeper+MailDev natively on Windows is
misery; here it's one command up, one command to wipe clean.
**Where:** `docker-compose.yml` — dissected service-by-service in Part 1 §2.
Note: only *infrastructure* runs in Docker; our backend runs directly on the
host for fast reload.

### git & GitHub
**git** = version control: every commit is a snapshot; branches are parallel
lines of work; you can always see what changed, when, why. **GitHub** = the
hosted copy + collaboration layer: **Pull Requests** (propose a branch → review
the diff → merge), Issues, **Dependabot** (bot that flags vulnerable
dependencies — see PROJECT_NOTES §5), **Actions** (runs our lint checks on
every push — "CI", continuous integration).
**Our flow:** `main` (releases) ← `develop` (integration) ← `feature/*`
branches, merged by PR. Conventional Commits (`feat(auth): …`). Part 1 §3.

### The small-but-everywhere dev tools
- **nodemon** — watches source files, restarts the server on save (`npm run
  dev`). Gotcha: doesn't watch `.env` — restart manually after env edits.
- **dotenv** — loads `.env` into `process.env` at boot (first import!).
- **ESLint 9** — static analysis: catches bugs and style drift without running
  the code. Both apps use the new "flat config" format.
- **winston** (+ morgan) — real logging: JSON **structured logs** with levels
  (`info/warn/error`), daily-rotated files, colorized console in dev. morgan
  feeds each HTTP request into it. `console.log` doesn't scale past one dev.
- **ms** — turns `"7d"` into milliseconds; how one env var (`7d`) drives JWT,
  cookie, and Redis expiry identically.
- **uuid / crypto.randomUUID** — collision-proof random IDs (our jtis).

---

## 8. Frontend technologies

### React 18
**What:** a library where the UI is a function of **state**: you describe *what
the screen should look like* for the current data (as **components** — reusable
UI functions returning **JSX**, the HTML-in-JS syntax), and React updates the
real page when state changes. You never manually "find element, change text."
**Where:** everything in `frontend/src/`.

### Vite
**What:** the dev server + bundler. In dev it serves modules natively with
near-instant hot reload; `npm run build` produces the optimized static files
you'd deploy. Also hosts the **dev proxy** that forwards `/api` → backend
(the FE↔BE glue, Part 1 §5).
**Why v6 specifically:** the security-patched line we verified after a CVE in
its bundled esbuild — the "minimum patched, not maximum shiny" principle.

### react-router-dom
**What:** an SPA has one HTML page, but users expect URLs (`/login`,
`/room/42`), back-button, bookmarks. The router maps URL ↔ component, swapping
components client-side with no page reload. `<Route>`, `<Link>`, `useNavigate`,
and later our `<ProtectedRoute>` gate.

### TanStack Query (react-query) vs zustand — the state split
- **react-query** manages **server state**: anything fetched from the API. It
  caches responses, dedupes identical requests, refetches stale data, and gives
  every query `isLoading / error / data` for free — replacing pages of manual
  `useEffect` + `fetch` + loading-flag code.
- **zustand** manages **client state**: small global facts that live only in
  the browser — for us, the in-memory access token + current user. A tiny store
  (~1kB) any component can read without React's prop-drilling.
**The mental model:** "list of rooms" → react-query. "Am I logged in?" → zustand.

### axios
**What:** an HTTP client, nicer than raw `fetch`, whose superpower is
**interceptors** — functions that run on *every* request/response. Ours will
(a) attach `Authorization: Bearer <access token>` automatically, and (b) on a
401, silently call `/refresh` once and retry — the invisible session-renewal
loop of the whole app.

### react-hook-form + zod
**What:** forms (login/register) need per-field state, validation, and error
display. react-hook-form handles the mechanics with minimal re-renders; **zod**
declares the validation schema (the frontend mirror of the backend's Joi rules —
same password policy, checked client-side for instant feedback, *and still
enforced server-side*: client checks are UX, never security).

### Tailwind CSS (+ PostCSS/autoprefixer, clsx, tailwind-merge)
**What:** instead of separate CSS files with invented class names, you compose
prebuilt utility classes in the JSX: `className="flex items-center gap-4
bg-gray-950"`. Only classes actually used end up in the shipped CSS (it scans
the source). PostCSS/autoprefixer are its build plumbing; `clsx` +
`tailwind-merge` build conditional class strings without conflicts. Brand
palette lives in `tailwind.config.js`.

### framer-motion / socket.io-client
Animations and the Socket.io browser client — both installed, both waiting for
their features (polish; chat/rooms).

---

## 9. Testing technologies

### Jest
**What:** the test runner: finds `*.test.js` files, runs each `it("does X")`
block, reports pass/fail. Provides `describe/it/expect` assertions
(`expect(res.status).toBe(401)`), **mocking** (replacing a real module with a
controllable fake), and coverage reports (which lines tests exercised).

### supertest
**What:** fires *real HTTP requests* at our Express `app` **without starting a
server** — `request(app).post("/api/auth/login").send({...})` returns the real
response, produced by the real middleware chain, routes, and controllers. It's
why our tests exercise the app exactly as a browser would.

### mongodb-memory-server
**What:** downloads a real MongoDB binary and runs it **in RAM** just for the
test run — real queries, real unique-index behavior, zero Docker, wiped
automatically. Tests get a production-faithful database with no setup.

### The fakes (our own code)
Real Redis and real SMTP are replaced in tests: a ~40-line in-memory **fake
Redis** implementing exactly the 8 commands our services call, and email spies
that **capture** the outgoing verification/reset URLs so tests can extract and
use the real one-time tokens (MailDev-in-an-array). Full anatomy: Part 2 §9.
**The philosophy:** test through the real app, fake only the edges, require
zero infrastructure — `npm test` runs anywhere in ~15s.

---

## 10. One-table summary

| Technology | One-liner | Where |
|---|---|---|
| Node.js 20 | JS runtime on the server | all of `backend/` |
| Express | web framework: routing + middleware | `app.js`, `routes/` |
| MongoDB + Mongoose | permanent JSON-document database + schema layer | `models/`, `config/mongo.js` |
| Redis | in-RAM key-value store with auto-expiry | token allowlist, `services/` |
| Kafka (+ZooKeeper) | durable event conveyor-belt for async work | `config/kafka.js` (plumbing) |
| Docker Compose | declares & runs all infra containers | `docker-compose.yml` |
| bcrypt | deliberately-slow password hashing | `models/User.js` |
| JWT | signed, unforgeable ID badge | `utils/token.js` |
| Passport (Google OAuth) | "sign in with Google" dance | `config/passport.js` |
| Joi | request-body validation schemas | `validators/` |
| nodemailer + MailDev | send email / catch it locally in dev | `services/email.service.js` |
| helmet / cors / rate-limit | security headers / cross-origin rules / brute-force brake | `app.js` |
| winston + morgan | structured JSON logging | `utils/logger.js` |
| Socket.io | real-time push (chat, signaling) | `sockets/` (stub) |
| WebRTC + mediasoup | live audio/video via SFU | Phase 3 |
| MinIO (S3 API) | self-hosted file storage | next feature (avatars) |
| React 18 | UI as a function of state | `frontend/src/` |
| Vite 6 | dev server + bundler + API proxy | `vite.config.js` |
| react-router | URL ↔ component mapping | `App.jsx` |
| react-query | server-state fetching/caching | `main.jsx` provider |
| zustand | tiny global client-state store | auth store (next) |
| axios | HTTP client with interceptors | API layer (next) |
| react-hook-form + zod | forms + client-side validation | auth pages (next) |
| Tailwind | utility-class styling | all components |
| Jest / supertest / mongodb-memory-server | test runner / HTTP-level tests / in-RAM Mongo | `backend/tests/` |
| git + GitHub (PRs, Actions, Dependabot) | version control + review + CI + security bot | the whole repo |
