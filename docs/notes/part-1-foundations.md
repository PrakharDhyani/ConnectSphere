# Part 1 — Foundations (everything shared by backend & frontend)

> **Who this is for:** future-me who forgot how the pieces fit. Written newbie-level:
> every term gets explained the first time it appears.
>
> This part covers what is **common to the whole project** — the infrastructure
> (Docker), the repo/git workflow, environment variables, and *how the frontend and
> backend actually talk to each other*. Feature-specific detail lives in
> [Part 2 (backend)](part-2-backend-auth.md) and [Part 3 (frontend)](part-3-frontend.md).

---

## 1. The big picture

ConnectSphere = a real-time video calling & collaboration platform (think: Zoom +
whiteboard + mini-games in one browser tab).

```
 Browser (React SPA, port 3000)
      │
      │  HTTP  /api/...          ← REST: login, rooms, profiles
      │  WebSocket /socket.io    ← real-time: chat, signaling
      ▼
 Express backend (Node 20, port 5000)
      │
      ├──► MongoDB  (port 27017) — permanent data: users, rooms, messages
      ├──► Redis    (port 6379)  — fast temporary data: refresh tokens, cache
      └──► Kafka    (port 9092)  — async event pipeline: recordings, notifications
```

**Two separate apps, one repo (a "monorepo"):**

```
connectsphere/
├── backend/     ← Node + Express API (its own package.json, its own node_modules)
├── frontend/    ← React + Vite SPA  (its own package.json, its own node_modules)
├── docs/        ← these notes
└── docker-compose.yml  ← the infrastructure both of them rely on
```

Each app is installed and run independently (`npm install` / `npm run dev` inside
each folder). They only meet over HTTP.

---

## 2. Docker Compose — the infrastructure

### What is Docker, in one paragraph?

Docker runs software in **containers** — isolated boxes that carry their own OS
libraries, so "MongoDB 7" runs identically on any machine. Instead of installing
Mongo, Redis, Kafka, ZooKeeper, and a mail catcher natively on Windows (version
drift, painful uninstalls), we describe them all in one file —
[docker-compose.yml](../../docker-compose.yml) — and Docker creates/destroys them
on command. Wipe everything and start fresh: `docker compose down -v`.

### Daily commands

```powershell
docker compose up -d          # start everything (detached = in background)
docker compose ps             # what's running + health
docker compose logs -f kafka  # follow one service's logs
docker compose down           # stop (data kept in volumes)
docker compose down -v        # stop AND wipe data — full reset
```

### The services, one by one

| Service | Container | Ports | What it's for |
|---|---|---|---|
| `mongo` (Mongo 7) | `cs_mongo` | 27017 | Primary database — users, rooms, messages |
| `redis` (Redis 7.2) | `cs_redis` | 6379 | In-memory store — refresh-token allowlist, cache, later Socket.io scaling |
| `zookeeper` | `cs_zookeeper` | 2181 | Kafka's coordination service (broker discovery, metadata) |
| `kafka` (Confluent 7.6) | `cs_kafka` | 9092 (host) / 9093 (in-Docker) | Durable event log — recording pipeline, notifications, analytics |
| `kafka-ui` | `cs_kafka_ui` | 8080 | Browser UI to inspect Kafka topics (dev convenience) |
| `maildev` | `cs_maildev` | 1080 (web UI) / 1025 (SMTP) | Catches all "sent" email locally — nothing ever leaves the machine |

### Concepts the file uses (and why they matter)

- **Healthchecks** — "container started" ≠ "service ready to accept connections."
  Each service defines a command Docker runs repeatedly (`mongosh ping`,
  `redis-cli ping`, …); only when it passes is the service *healthy*. Combined with
  `depends_on: condition: service_healthy`, Kafka literally waits for ZooKeeper to
  be ready instead of crash-looping.
- **Named volumes** (`mongo_data:` etc.) — containers are disposable; volumes are
  where the actual data lives so a restart doesn't wipe your users.
- **One bridge network** (`cs_network`) — every container can reach the others *by
  service name* (`mongo`, `redis`, `kafka`). Your host machine instead uses
  `localhost:<published port>`.
- **Kafka's dual listeners** — the subtle one. Kafka tells clients an *advertised
  address* to reconnect to. A client on your laptop needs `localhost:9092`; a client
  inside Docker needs `kafka:9093`. One listener each, or one side can't connect.

### Rule of thumb: host vs container addresses

Our backend runs **on the host** (`npm run dev`), so its `.env` uses
`localhost:27017`, `localhost:6379`, `localhost:9092`, `localhost:1025`. If the
backend ever moves *into* Docker, those become `mongo`, `redis`, `kafka:9093`,
`maildev`. Getting this wrong is the #1 "it can't connect!" cause.

### War stories (worth retelling — details in PROJECT_NOTES §2)

1. Image pulls kept failing → Docker Desktop's *containerd image store* is fragile
   on unstable connections; switching back to the classic puller fixed it.
2. ZooKeeper healthcheck used `ruok`, which the Confluent image blocks and whose
   whitelist env var the image *silently ignores* (not in its template). Fix: use
   the already-whitelisted `srvr` command. Lesson: when a config env var "doesn't
   work," check whether the image's entrypoint actually maps it.

---

## 3. Git & GitHub workflow

### Branch model

```
main      ← releases only; moved by deliberate merges
develop   ← integration branch; every feature PRs into here
feature/* ← one branch per feature (also fix/*, chore/*, test/*)
```

### The loop for every feature

```powershell
git checkout develop; git pull origin develop     # start fresh
git checkout -b feature/<name>                    # branch off develop
# ... build, commit in small conventional commits ...
git push -u origin feature/<name>                 # publish
# open PR on GitHub: base = develop  ← CHECK THE DROPDOWN (see war story 1)
```

- **Conventional Commits:** `feat(auth): …`, `fix: …`, `chore: …`, `test(auth): …`,
  `docs: …` — machine-parseable history, easy changelogs.
- **Every change lands via PR**, even solo — the "Files changed" self-review
  genuinely catches mistakes.
- **CI (GitHub Actions)** lints backend + frontend on every push/PR.

### War stories (details in PROJECT_NOTES §4)

1. A PR got merged into `main` because GitHub defaults the base dropdown to the
   default branch. Detected via `git log --graph --all`; repaired with a
   fast-forward. **Always check the base dropdown.**
2. A feature branch was created while HEAD sat on a Dependabot branch and silently
   carried its commit. Recovered with `git stash -u` → recreate branch → `stash pop`.
3. A commit landed on a branch *after* its PR merged and never reached `main`.
   **After merging, verify the merged content.**

---

## 4. Environment variables (`.env`)

**What:** configuration that differs per machine/environment (ports, DB addresses,
secrets) lives in an untracked `.env` file, loaded into `process.env` at boot by
the `dotenv` package. `.env.example` is the committed, secret-free template.

**Why not hardcode?** Secrets must never enter git history, and the same code must
run in dev (localhost, MailDev) and prod (Atlas, Resend) without edits.

Key backend variables (grouped):

| Group | Vars | Notes |
|---|---|---|
| Server | `PORT`, `NODE_ENV`, `CLIENT_URL`, `SERVER_URL` | `CLIENT_URL` = the frontend origin (CORS + redirects) |
| Databases | `MONGO_URI`, `REDIS_HOST`, `REDIS_PORT`, `KAFKA_BROKER` | host-vs-container rule from §2 applies |
| JWT | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (7d) | secrets are 96-char random hex (`crypto.randomBytes(48)`) |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | optional — code degrades gracefully without them |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | dev = MailDev (`localhost:1025`, no auth); prod = Resend/Brevo — zero code change |

**Gotchas we hit:**
- nodemon watches `.js` files, **not `.env`** — after editing `.env`, restart manually.
- Rotating a JWT secret invalidates every existing token — which is exactly what
  rotating a signing secret *should* do.

---

## 5. How frontend and backend talk (the part that confuses everyone)

Two dev servers run side by side:

- **Vite dev server** on `http://localhost:3000` — serves the React app, hot-reloads.
- **Express** on `http://localhost:5000` — the actual API.

### Problem: the browser's Same-Origin Policy

`:3000` and `:5000` are *different origins*. A page from one origin can't freely
call the other — the browser blocks it (CORS). Two tools handle this:

**1. Vite dev proxy** ([vite.config.js](../../frontend/vite.config.js)) — the fix we
rely on in dev. The React app calls **relative** URLs (`/api/auth/login`); Vite
forwards anything under `/api` (and `/socket.io`, WebSockets included) to `:5000`.
The browser thinks it's talking to `:3000` the whole time → *no cross-origin
request ever happens* → CORS never bites, and cookies behave as same-site.

**2. CORS middleware** ([app.js](../../backend/src/app.js)) — the backend still
whitelists `CLIENT_URL` with `credentials: true`. Belt-and-suspenders in dev; in a
real deployment where FE and BE are separate origins, it's what makes the API
callable at all.

### Where auth state lives (decided in the backend design, affects FE too)

- **Access token (15 min)** → JSON response → frontend keeps it **in memory only**
  (a variable, not localStorage — any XSS can read localStorage).
- **Refresh token (7 days)** → **httpOnly cookie** — page JavaScript *cannot* read
  it; the browser attaches it automatically to `/api/auth/refresh` calls.
- Page reload → memory wiped → the SPA silently calls `/refresh` → new access
  token. That's the "how do I stay logged in?" answer.

---

## 6. Shared tooling & conventions

- **Node ≥ 20** (both apps pin `engines`), ESM everywhere (`"type": "module"` —
  `import`/`export`, not `require`).
- **ESLint 9 flat config** (`eslint.config.js`) in both apps — the new config
  format ESLint 9 requires (the old `.eslintrc` is dead; upgrading the react-hooks
  plugin to v5 was needed for compatibility).
- **Testing:** backend has a Jest + supertest suite (37 tests) that needs **no
  Docker** — in-memory Mongo + faked Redis/email. `npm test` in `backend/`.
  Full explanation in [Part 2 §"tests/"](part-2-backend-auth.md).
- **Free-tier constraint:** no paid cloud services anywhere. Every choice has a
  free/self-hosted answer (MinIO for S3, MailDev→Resend for email, Atlas M0,
  Upstash, coturn, Render/Fly). Table in PROJECT_NOTES §"No Paid Cloud Services".

### Ports cheat-sheet

| Port | What |
|---|---|
| 3000 | React (Vite dev server) |
| 5000 | Express API |
| 27017 / 6379 / 9092 / 2181 | Mongo / Redis / Kafka(host) / ZooKeeper |
| 8080 | Kafka UI · **1080** MailDev UI · **1025** MailDev SMTP |

**Recurring annoyance:** a stale node process holding :5000 (`EADDRINUSE`) —
`netstat -ano | findstr :5000`, then kill the PID.
