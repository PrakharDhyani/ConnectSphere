# ConnectSphere — Feature Requirements Specification

> **Vision:** Zoom + Snapchat + Figma + mini-games, all in one browser tab.
> A production-grade real-time video collaboration platform, built to learn
> full-stack + real-time + ML engineering the way a real team would ship it.

**Status legend**

| Tag | Meaning |
|---|---|
| ✅ | In original plan |
| ⭐ | **Suggested addition** (new idea proposed during review) |
| 🔬 | Advanced / stretch — high learning value, optional |

**Priority legend:** `P0` MVP · `P1` Core · `P2` Delight · `P3` Polish · `P4` Stretch

---

## 1. Product Overview

ConnectSphere lets people create or join a **room** and, inside it, do far more
than talk: collaborate on a whiteboard, play games, apply AR filters, share and
annotate screens, record the session, and get an AI-generated summary afterward.

**Primary personas**
- **Host** — creates rooms, moderates, records, schedules.
- **Participant** — joins via link, uses A/V + collaboration tools.
- **Guest** — joins a public room without an account (link/QR).
- **Admin** — platform operator; manages users, moderates abuse, sees analytics.

---

## 2. Feature Catalog

### 2.1 — P0 · MVP (must-have to demo)

| # | Feature | Notes |
|---|---|---|
| ✅ | **Authentication** | Email/password (bcrypt) + JWT access (15m) & refresh (7d) tokens; Google OAuth. |
| ⭐ | Refresh-token rotation + Redis blacklist | Invalidate on logout; detect token reuse. |
| ⭐ | Email verification + password reset | Token via email; core to a "real" auth system. |
| ✅ | **Dashboard** | Recent rooms, quick-create, join-by-code, profile summary. |
| ✅ | **Room management** | Create/join/leave/delete; unique join code + shareable link; public vs private. |
| ⭐ | Room roles & permissions | host / co-host / participant; permission matrix. |
| ✅ | **Video/Audio calls** | mediasoup SFU; publish/consume tracks; mute/unmute; camera on/off. |
| ⭐ | Device selection & pre-join lobby | Pick camera/mic/speaker, preview, test — before joining. |
| ⭐ | Active-speaker detection & grid/speaker layouts | mediasoup dominant-speaker; responsive tile grid. |
| ⭐ | Network quality indicator | Derived from WebRTC `getStats()` (RTT, packet loss, jitter). |
| ✅ | **Real-time chat** | Socket.io; per-room; persisted in MongoDB; history on join. |
| ⭐ | Typing indicators + presence | "X is typing", online/away/in-call. |

### 2.2 — P1 · Core Collaboration

| # | Feature | Notes |
|---|---|---|
| ✅ | **Collaborative whiteboard** | Fabric.js + Socket.io; pen, shapes, text, colors. |
| ⭐ | Whiteboard: multi-cursor presence | Live named cursors of each participant. |
| ⭐ | Whiteboard: infinite canvas, sticky notes, export PNG/PDF | Figma-like depth. |
| ⭐ | **Conflict-free sync via CRDT (Yjs)** 🔬 | Replace naive last-write-wins with Yjs for whiteboard + docs; teaches CRDTs. |
| ✅ | **Snapchat-style 2D face filters** | TensorFlow.js + face-api.js landmark overlays. |
| ✅ | **Virtual backgrounds** | BodyPix / MediaPipe Selfie Segmentation. |
| ⭐ | Background blur + beauty filter | Cheaper, very popular; same segmentation pipeline. |
| ✅ | **Screen sharing** | getDisplayMedia → mediasoup; with live annotation layer. |
| ⭐ | **Collaborative code editor** 🔬 | Monaco + Yjs — pair-programming inside a call. |
| ⭐ | Shared notes / meeting doc | Simple Yjs-backed rich text; exportable. |
| ⭐ | File sharing in chat | Drag-drop → S3 presigned upload; inline previews. |
| ⭐ | Emoji reactions & "raise hand" | Floating emojis + ordered hand-raise queue. |

### 2.3 — P2 · Delight

| # | Feature | Notes |
|---|---|---|
| ✅ | **Mini-games mid-call** | Skribbl clone, Trivia, Tic-Tac-Toe. |
| ⭐ | More games | Rock-Paper-Scissors, Connect-4, Codenames, Chess, quiz-buzzer. |
| ⭐ | Game framework + leaderboards | Shared game-state engine over Socket.io; per-room scores. |
| ✅ | **Call recording** | Kafka → consumer → ffmpeg compose → S3; downloadable. |
| ⭐ | Recording layouts + chapters | Grid vs speaker; auto chapter markers on events. |
| ✅ | **Memories & snapshots** | Capture composited frame → S3; per-room gallery. |
| ✅ | **Emoji reactions** | (see P1 — reactions promoted earlier). |
| ⭐ | **Live captions & transcription** 🔬 | Web Speech API (live) → optional Whisper for accuracy. |
| ⭐ | **AI meeting summary + action items** 🔬 | Transcript → Claude API → summary, decisions, TODOs, emailed to host. |
| ⭐ | Live translation of captions 🔬 | Per-user target language. |
| ⭐ | Polls & Q&A | Host launches poll; live results; upvoted questions. |
| ⭐ | Co-watch / watch party | Synced YouTube playback with shared controls. |

### 2.4 — P3 · Polish

| # | Feature | Notes |
|---|---|---|
| ✅ | **Themes** | Light/dark/system; accent colors; persisted. |
| ✅ | **Animations** | Framer Motion transitions, reaction physics. |
| ✅ | **PWA** | Installable, offline shell, cached assets. |
| ✅ | **Scheduling** | Schedule rooms; recurring meetings; `.ics` + Google Calendar. |
| ✅ | **Push notifications** | Web Push (VAPID) — invites, "meeting starting", mentions. |
| ⭐ | Email invitations | Invite by email with join link; RSVP. |
| ⭐ | Guest access via link + QR code | Join without account; QR for mobile handoff. |
| ⭐ | Internationalization (i18n) | react-i18next; RTL support. |
| ⭐ | Full accessibility (a11y) | Keyboard nav, ARIA, focus management, captions, reduced-motion. |
| ⭐ | Profile & settings | Avatar upload, display name, notification prefs, devices. |

### 2.5 — P4 · Stretch / Advanced (great résumé material)

| # | Feature | Notes |
|---|---|---|
| ⭐ | **Moderation suite** | Mute-all, remove/ban participant, lock room, disable chat, waiting room admission. |
| ⭐ | **Waiting room / lobby** | Host admits knockers one-by-one or all. |
| ⭐ | **Breakout rooms** | Split participants into sub-rooms; timed; broadcast to all. |
| ⭐ | **Webinar mode** | View-only attendees + promoted speakers; scales to large audiences. |
| ⭐ | **Live streaming / RTMP broadcast** 🔬 | Push room to YouTube/Twitch via ffmpeg. |
| ⭐ | **Simulcast + adaptive bitrate** 🔬 | mediasoup simulcast layers; server picks layer per consumer bandwidth. |
| ⭐ | **E2EE for media** 🔬 | WebRTC insertable streams (SFrame); teaches applied crypto. |
| ⭐ | **AR 3D masks / gesture reactions** 🔬 | Three.js masks; hand-gesture → auto emoji (MediaPipe Hands). |
| ⭐ | **Spatial audio** 🔬 | Web Audio panner tied to tile position. |
| ⭐ | **Noise suppression** 🔬 | RNNoise WASM in an audio worklet. |
| ⭐ | **Host analytics dashboard** | Attendance, talk-time, engagement, join/leave timeline. |
| ⭐ | **Admin panel** | User management, room oversight, abuse reports, feature flags. |
| ⭐ | **2FA (TOTP) + magic-link login** | Harden auth; passwordless option. |
| ⭐ | Post-call feedback / rating | NPS + quality rating feeds analytics. |
| ⭐ | Gamification | Badges, achievements, streaks. |

---

## 3. Non-Functional Requirements

### 3.1 Security
- Passwords hashed with bcrypt (≥12 rounds); never logged.
- JWT: short-lived access + rotating refresh; refresh stored httpOnly cookie; Redis reuse-detection blacklist.
- Input validation on **every** endpoint (Joi backend, Zod frontend).
- Helmet, CORS allowlist, per-route rate limits (stricter on auth), CSRF protection on cookie flows.
- Presigned S3 URLs (no public bucket); server-side content-type/size checks on upload.
- Secrets only via env / secret manager; never committed; `.env` gitignored.
- Authorization checks on socket events, not just REST (a socket can't act on a room it hasn't joined).

### 3.2 Performance & Scalability
- Socket.io Redis adapter → horizontal scaling across Node instances.
- mediasoup workers = CPU cores; router-per-room; scale SFU independently.
- Kafka decouples heavy async work (recording, notifications, analytics) from the request path.
- MongoDB indexes on hot query paths (roomCode, userId, room+createdAt for messages).
- Pagination on chat history, recordings, room lists.
- CDN for frontend + media; client-side lazy loading + code splitting per route/feature.

### 3.3 Observability
- Winston structured JSON logs (already scaffolded) → Loki/CloudWatch.
- Prometheus metrics (HTTP latency, active rooms, SFU stats) + Grafana dashboards.
- Health/readiness/liveness endpoints for k8s.
- Correlation IDs across HTTP + socket + Kafka for tracing a session.

### 3.4 Reliability
- Graceful shutdown (drain sockets, close producers) — partially scaffolded.
- Reconnection strategy client-side (Socket.io auto-reconnect + mediasoup ICE restart).
- Idempotent Kafka consumers; dead-letter topic for poison messages.

### 3.5 Quality & Process
- Testing: Jest (backend unit/integration), Vitest + React Testing Library (frontend), Playwright (E2E for join-call flow).
- CI: lint → test → build → (later) image push; branch protection on `main`/`develop`.
- Conventional Commits + PR template (scaffolded) + at-least-1-review rule.
- ESLint + Prettier + Husky pre-commit hooks.

### 3.6 Accessibility & i18n
- WCAG 2.1 AA target; keyboard operable; visible focus; captions; `prefers-reduced-motion`.
- Copy externalized for i18n from the start (even if only `en` initially).

---

## 4. High-Level Architecture

```
                         ┌────────────────────────────┐
   Browser (React SPA)   │  Vite + React + Tailwind    │
   - WebRTC (mediasoup   │  Zustand, React Query        │
     client)             │  Socket.io client            │
   - TensorFlow.js ML     └───────────┬──────────────────┘
                                      │ HTTPS / WSS
                          ┌───────────▼───────────┐
                          │   Node.js / Express     │  ← REST (auth, rooms, users)
                          │   Socket.io (rooms,     │  ← real-time signaling, chat,
                          │     chat, whiteboard,    │     whiteboard, games
                          │     games, reactions)    │
                          │   mediasoup SFU workers  │  ← media routing
                          └──┬────────┬───────┬──────┘
                             │        │       │
                   ┌─────────▼──┐ ┌───▼───┐ ┌─▼───────┐
                   │  MongoDB    │ │ Redis │ │  Kafka   │
                   │ users/rooms │ │adapter│ │ events → │
                   │ msgs/records│ │ cache │ │ workers  │
                   └─────────────┘ └───────┘ └────┬─────┘
                                                  │
                                        ┌─────────▼─────────┐
                                        │ Consumers: ffmpeg  │→ AWS S3
                                        │ recording, notif,  │  (recordings,
                                        │ transcription, AI  │   snapshots)
                                        └────────────────────┘
```

---

## 5. Data Model (initial sketch)

- **User** — `name, email, passwordHash, googleId, avatarUrl, role, emailVerified, createdAt`
- **Room** — `code, name, hostId, visibility, isLocked, maxParticipants, scheduledFor, settings{}, createdAt`
- **RoomMember** — `roomId, userId, role, joinedAt, leftAt` (or embedded/ephemeral in Redis)
- **Message** — `roomId, senderId, type(text|file|system), content, attachmentUrl, createdAt`
- **Recording** — `roomId, startedBy, status, s3Key, durationSec, createdAt`
- **Snapshot** — `roomId, capturedBy, s3Key, createdAt`
- **WhiteboardDoc** — `roomId, yjsState/objects, updatedAt`
- **GameSession** — `roomId, gameType, state{}, scores{}, startedAt`
- **Notification** — `userId, type, payload, read, createdAt`

Ephemeral (Redis): live room presence, socket→user map, active-speaker, typing.

---

## 6. Suggested Build Order (feature-by-feature, one branch each)

Each row = one `feature/<name>` branch → PR → merge to `develop`.

| Phase | Branch | Delivers |
|---|---|---|
| 0 | `chore/scaffold-fixes` | Fix HomePage casing, Kafka broker port/env split, aws-sdk v3, Prettier/Husky. |
| 1 | `feature/auth` | Register/login/logout, JWT + refresh rotation, Google OAuth, verify/reset, guarded routes. |
| 2 | `feature/user-profile` | Profile page, avatar upload to S3, settings. |
| 3 | `feature/rooms` | Room CRUD, join code, dashboard, pre-join lobby, roles. |
| 4 | `feature/video-core` | mediasoup SFU, publish/consume, mute/camera, grid + active speaker. |
| 5 | `feature/chat` | Real-time chat, history, typing, presence, file share. |
| 6 | `feature/reactions` | Emoji reactions + raise hand. |
| 7 | `feature/whiteboard` | Fabric.js/Yjs whiteboard, multi-cursor, export. |
| 8 | `feature/filters-bg` | Face filters + virtual background + blur. |
| 9 | `feature/screenshare` | Screen share + annotation. |
| 10 | `feature/games` | Game framework + first 3 games + leaderboard. |
| 11 | `feature/recording` | Kafka → ffmpeg → S3 pipeline + snapshots. |
| 12 | `feature/ai-summary` | Captions + transcript + Claude summary. |
| 13 | `feature/scheduling-notifs` | Scheduling, calendar, web push, email invites. |
| 14 | `feature/moderation` | Waiting room, moderation suite, breakout rooms. |
| 15 | `feature/polish` | Themes, animations, PWA, i18n, a11y. |
| 16 | `feature/observability` | Prometheus/Grafana, tracing, k8s manifests. |

> We build **thin vertical slices**: each feature ships backend + frontend + tests
> together so it's demoable at merge, rather than "all backend then all frontend."

---

## 7. Open Decisions (to confirm as we go)

1. **Whiteboard sync:** naive Socket.io broadcast first, or invest in Yjs/CRDT up front? *(Recommend: start naive, refactor to Yjs at Phase 7's end as a teaching moment.)*
2. **mediasoup vs. hosted SFU:** self-host mediasoup (max learning) — confirmed by stack.
3. **Transcription engine:** browser Web Speech API (free, live) vs. Whisper (accurate, heavier).
4. **Deploy target:** local k8s (kind/minikube) vs. a cloud cluster for the capstone demo.
5. **Monorepo tooling:** stay with plain npm workspaces, or adopt Turborepo/pnpm?

---

## 8. Review Notes on Current Scaffold (2026-07-11)

- 🔴 `frontend/src/App.jsx` imports `HomePage.jsx`/`NotFoundPage.jsx` but files may be cased differently (`Homepage.jsx`) — **breaks on Linux/CI**. Fix filename casing to match imports.
- 🟠 `.env.example` `KAFKA_BROKER=kafka:9092` conflicts with the Compose advertised listeners (`kafka:9093` in-network, `localhost:9092` on host). Document host vs. container env.
- 🟡 `aws-sdk` v2 → migrate to `@aws-sdk/client-s3` v3; bump `multer` to 2.x; drop obsolete `version:` key in `docker-compose.yml`.
- ✅ Otherwise: clean separation (app vs. server), solid logging, health checks, rate limiting, CI lint, PR template, sensible dependency choices, excellent teaching comments.
