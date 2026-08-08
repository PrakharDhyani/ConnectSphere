# ConnectSphere → Activity Platform: Architecture & Migration Plan

**Status:** proposal — no code changed yet.
**Last updated:** 2026-08-06 (scope narrowed after review).
**Scope:** make Whiteboard and the games into plugins. The room itself stays core.

---

## 0. Scope

**Core — never a plugin.** The room shell that is always present:
chat/text · video calling · screen sharing · voice · presence · membership · moderation · auth ·
**polls**.

> **The test, settled by the polls round-trip (PROJECT_NOTES §48):** if uninstalling it makes the
> room *worse for everyone* rather than merely *different*, it is infrastructure. Polls were
> migrated onto the host successfully and then reverted, because "runs on the plugin architecture"
> and "the user may uninstall it" are independent properties — and the plugin system was coupling
> them, so polls showed up in the wizard as an optional feature you could decline.

**Plugins — starting now.** Everything that occupies the Board or Game surface:
`whiteboard` · `draw-guess` · `ludo` · `chess` · `uno` · `typing-race` · `bingo` · `smash-karts`.

**Plugins — later.** Code editor, Kanban, mind map, sticky notes, music room, quiz, and the rest of
the catalogue in §7. None of these are built now; the architecture just must not have to change to
accept them.

This boundary is the right one, and it happens to be almost exactly where the code already splits.
The Board and Game tabs are self-contained surfaces; chat and media are the substrate underneath
them. Nothing in the plugin set needs to *be* chat or *own* an SFU router — they only need to sit in
a tab, sync state, and persist.

**Consequence: a much smaller SDK.** Games and whiteboard need five capabilities, not ten. There is
no `sdk.chat` and no `sdk.video` in v1, because nothing in scope needs them. That is a smaller
surface to freeze and be confident about (§5.2).

---

## 1. Analysis of the existing code

### 1.1 Where the games layer actually stands

Measured, not assumed:

| Handler | Lines | Uses `lobbyGame.js`? | Migration cost |
|---|---|---|---|
| `chess.handlers.js` | 210 | ✅ | trivial |
| `uno.handlers.js` | 237 | ✅ | trivial |
| `typing.handlers.js` | 149 | ✅ | trivial |
| `bingo.handlers.js` | 212 | ✅ | trivial |
| `poll.handlers.js` | 131 | ❌ bespoke | small |
| `whiteboard.handlers.js` | 127 | ❌ bespoke | small, clean boundary |
| `game.handlers.js` (draw-guess) | 311 | ❌ bespoke | medium |
| `ludo.handlers.js` | 536 | ❌ bespoke | medium-large |
| `kart.handlers.js` | 478 | ❌ bespoke, **runs its own `setInterval` physics loop at `TICK_HZ`** | large |

**Four** games are thin configs over the framework — those are near-mechanical to convert.
**Three** are heavyweight and bespoke: Ludo and Kart grew the logic that later *became*
`lobbyGame.js` but were never moved onto it, and Draw & Guess predates it entirely.

Kart is the genuinely hard one: a real-time simulation with a server tick loop, not a turn-based
state machine. Its plugin lifecycle must guarantee the interval is cleared on `destroy()` or a
leaked loop will burn CPU for the life of the process. **Migrate Kart last**, and treat its
`destroy()` as the reference test for lifecycle correctness.

### 1.2 What is already plugin-shaped and must be preserved

- **`backend/src/sockets/lobbyGame.js`** is already a plugin framework. Games supply pure callbacks
  (`start`, `publicState`, `privateState`, `botAct`, `afkDeadline`, `tick`) and receive
  `ctx = { g, io, roomId, broadcast, notice, endGame }` — they never touch Socket.IO directly.
  **That is an SDK.** The plugin contract should extend it, not replace it.
- **`GamesHub.jsx`** — a `GAMES[]` array plus `lazy()` panels: a hardcoded registry with dynamic
  mounting. Becomes a registry-driven category view.
- **`canAccessRoom()`** (`utils/roomAccess.js`) — single authority for room access. Plugin
  permissions sit *on top of* it, never beside it.
- **`allow(socket, key, n, ms)`** (`utils/socketRate.js`) — the SDK should apply this automatically
  so a plugin cannot forget it.
- **Lazy loading.** Excalidraw is ~1.8 MB and `chess.js` is heavy. A registry that eagerly imported
  plugin code would be a serious bundle regression.

### 1.3 The three places that hardcode "which activities exist"

These are the only real coupling points, and they are exactly the "adding a plugin breaks things"
vector:

1. **`sockets/index.js:50-61`** — 12 hardcoded `registerXHandlers(io, socket)` calls, run for every
   socket whether the room uses that activity or not.
2. **`RoomPage.jsx:546`** — the literal tab array `[["room",…],["board",…],["game",…]]`.
3. **`RoomPage.jsx:31-44`** — `ACT_LABEL` / `ACT_VIEW`, a hand-maintained map from activity id to
   toast text and destination tab.

Plus `GamesHub.jsx:28-36`, the `GAMES[]` array.

**Today, adding one game means editing four files that have nothing to do with that game.** That is
the thing to fix. Everything else in the migration follows from it.

> **All four are now resolved.** 1 and 2–3 went in Phases 2–3. The fourth —
> `GamesHub`'s `GAMES[]` — survived until PROJECT_NOTES §48, because the tab bar above it had
> become manifest-driven and *looked* correct while the arcade underneath still listed every game
> ever written. It surfaced as a user report ("I selected a few games but all of them show up"),
> not as a failing test. Worth remembering: a coupling point that is half-fixed reads as fixed.

---

## 2. The non-breakability guarantees

This is the actual requirement — the plugin catalogue is just the surface. Six structural
guarantees, each with the mechanism that enforces it:

| # | Guarantee | Mechanism |
|---|---|---|
| 1 | **Adding a plugin edits no existing file** | drop a folder in `activities/<id>/`, register its manifest; registry + runtime discover it. No touching `sockets/index.js`, `RoomPage.jsx`, or `GamesHub.jsx`. |
| 2 | **A crashing plugin cannot take down the room** | React error boundary per plugin; server dispatcher try/catches per handler invocation |
| 3 | **A broken manifest fails at boot, loudly** | `validateManifest()` throws at registration — not a blank tab for one user at 2 a.m. |
| 4 | **A missing plugin degrades, never white-screens** | unknown id → "unavailable" placeholder + log; matters as soon as two deploys differ |
| 5 | **A plugin cannot reach app internals** | capability SDK is the only import; enforced by ESLint `no-restricted-imports` scoped to `activities/*` |
| 6 | **A plugin cannot leak resources** | `destroy()` is mandatory in the contract; the host asserts timers/intervals/listeners are cleared (Kart's physics loop is the test case) |

Guarantee 1 is the one that makes the project scalable in practice. The other five are what make it
safe.

---

## 3. Target architecture

```
┌──────────────── ROOM CORE (always present, never a plugin) ─────────────────┐
│  Auth · Membership · Presence · Chat/Text · Video · Screen share · Voice    │
│  Moderation · Access control                                               │
│  Room document gains:  activities.installed[] · activities.active          │
└───────────────┬────────────────────────────────────────┬────────────────────┘
                │                                        │
        ┌───────▼────────┐                      ┌────────▼─────────┐
        │ PLUGIN REGISTRY│   manifests only     │  PLUGIN REGISTRY │
        │   (frontend)   │                      │    (backend)     │
        └───────┬────────┘                      └────────┬─────────┘
                │                                        │
        ┌───────▼────────┐                      ┌────────▼─────────┐
        │ ACTIVITY       │  mount · lifecycle   │ PLUGIN HOST      │
        │ RUNTIME        │  error boundary      │ dispatch·init·destroy │
        └───────┬────────┘                      └────────┬─────────┘
                │            ┌──────────┐                │
                └───────────►│ EVENT BUS│◄───────────────┘
                             └──────────┘
                                  │
                            ┌─────▼─────┐
                            │ PLUGIN SDK│  socket · room · storage · presence · events
                            └───────────┘
```

### 3.1 Three artefacts per plugin

Split so the client never ships server code and the wizard never ships React components:

| Artefact | Path | Loaded |
|---|---|---|
| **Manifest** (data only) | `shared/activities/<id>/manifest.js` | always — ~1 KB |
| **Client module** | `frontend/src/activities/<id>/index.jsx` | on first mount, via `lazy()` |
| **Server module** | `backend/src/activities/<id>/server.js` | at boot |

**Why manifests are shared.** The creation wizard, the recommendation engine and the server's
permission check all need the same metadata. Two copies guarantee drift. Manifests are plain data
with no imports, so they are safe in both bundles.

```js
// shared/activities/ludo/manifest.js
export default {
  id: "ludo",
  version: "1.0.0",
  name: "Ludo",
  description: "Classic 2–4 player board game, with bots.",
  icon: "🎲",
  category: "games",          // "games" | "creativity" | "productivity" | "learning"
  surface: "game",            // "board" | "game" | "tab" | "overlay"

  recommendedFor: { fun: 1.0, team: 0.5, study: 0.1 },

  // The SDK is BUILT from this list — an undeclared capability is absent, not denied.
  permissions: ["room:read", "socket:namespaced", "storage:room", "presence:read"],

  // The wizard renders this. Closed grammar → every valid schema is renderable.
  configSchema: {
    maxPlayers: { type: "number", label: "Max players", default: 4, min: 2, max: 4 },
    turnTimer:  { type: "select", label: "Turn timer", default: 30,
                  options: [{ value: 15, label: "15s" }, { value: 30, label: "30s" }, { value: 0, label: "Off" }] },
    allowBots:  { type: "boolean", label: "Allow bots", default: true },
  },

  minPlayers: 2, maxPlayers: 4,
  singleton: true,       // one instance per room
  requires: [],          // plugin dependencies
};
```

### 3.2 Room model — additive only

```js
activities: {
  installed: [{
    id:      { type: String, required: true },
    version: { type: String },                            // pinned → future updates
    config:  { type: Schema.Types.Mixed, default: {} },   // validated against configSchema
    enabled: { type: Boolean, default: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User" },
    addedAt: { type: Date, default: Date.now },
  }],
  active: { type: String, default: null },
},
purpose: { kind: { type: String }, text: { type: String, maxlength: 200 } },
```

### 3.3 Backward compatibility — a resolver, not a migration

Existing rooms have no `activities` field. Absence resolves to "everything", so old rooms behave
exactly as they do today:

```js
const LEGACY_DEFAULT = ["whiteboard", "draw-guess", "ludo", "chess", "uno",
                        "typing-race", "bingo", "smash-karts", "poll"];

export function resolveInstalled(room) {
  if (room.activities?.installed?.length) return room.activities.installed;
  return LEGACY_DEFAULT.map((id) => ({ id, config: {}, enabled: true, legacy: true }));
}
```

No batch job, no deploy step, no downtime, fully reversible. A room upgrades itself the first time
someone edits its activities. A backfill script can run later purely as cleanup — never as a
prerequisite.

---

## 4. Plugin Registry

```js
// shared/activities/registry.js — isomorphic, manifests only
export function registerPlugin(manifest) {
  validateManifest(manifest);                    // throws at boot, not at mount
  if (plugins.has(manifest.id)) throw new Error(`Duplicate plugin id: ${manifest.id}`);
  plugins.set(manifest.id, Object.freeze(manifest));
}
export const getPlugin            = (id) => plugins.get(id) ?? null;
export const getAllPlugins        = ()   => [...plugins.values()];
export const getPluginsByCategory = (c)  => getAllPlugins().filter((p) => p.category === c);
export const getRecommendedPlugins= (ctx)=> recommend(ctx);
```

- **Manifests, not implementations** — registering components would drag every plugin into the
  initial bundle and kill the existing lazy loading.
- **Validate at registration** — a malformed manifest crashes the server at boot with a clear
  message.
- **`Object.freeze`** — manifests are shared across every room; one plugin mutating another's would
  be untraceable.

---

## 5. Runtime, SDK, Event Bus

### 5.1 Frontend runtime

`ActivityHost` resolves the manifest → `lazy()`-loads the client module → builds the SDK from
`manifest.permissions` → calls `init(sdk)` → renders inside an **error boundary** → calls
`destroy()` on unmount.

**Keep mounted activities alive but hidden on tab switch; do not unmount.** `GamesHub` already
persists the open game to `sessionStorage` precisely because unmounting loses game state. Leaving a
live Ludo game to check chat and losing the board would regress current behaviour. Two consequences
that must be handled explicitly:

- **Memory** — cap concurrently mounted activities (LRU, ~3) and evict the least recent.
- **The `display:none` trap** — we hit this exact class of bug with the GIF thumbnails. Canvases and
  `loading="lazy"` images inside a hidden subtree never size or load correctly. Canvas plugins
  (`smash-karts`, `whiteboard`) get `sdk.lifecycle.onHidden()` / `onShown()` so they can pause the
  render loop and re-measure. **Kart must pause its loop when hidden** — a hidden 3D game rendering
  at full rate is a battery bug nobody will attribute to tab switching.

### 5.2 The SDK — five capabilities, built per plugin

Narrowing the scope to whiteboard + games cuts this from ten capabilities to five. Nothing in scope
needs chat or video, so neither is in v1:

```js
sdk.meta       // { id, version, config }  — the room's config for this plugin
sdk.socket     // namespaced emit/on  (§5.3)
sdk.room       // read-only: id, name, members, isOwner
sdk.storage    // persist plugin state per room  (whiteboard scenes, game results)
sdk.presence   // who is here
sdk.events     // the bus  (§5.4)   — always granted
sdk.lifecycle  // onHidden/onShown/onDestroy — always granted
```

**Capability-based, not check-based.** An ungranted capability is `undefined`, so calling it is a
`TypeError` at the plugin's own call site in development — not a permission check that fails later,
in production, in someone else's stack frame. **Absent beats denied.**

`sdk.chat`, `sdk.video`, `sdk.ai`, `sdk.http` are deliberately **not** in v1. They are additive when
a plugin genuinely needs them (an AI tutor will want `sdk.ai`), and adding a capability later breaks
nothing — that is the point of building the SDK from a declared list.

### 5.3 Namespaced sockets — the key isolation rule

```
plugin calls:      sdk.socket.emit("move", { from, to })
wire carries:      "activity:ludo:move"
server routes to the ludo plugin only, after:
  1. canAccessRoom(user, roomId)                      — existing authority, unchanged
  2. room has ludo installed + enabled
  3. allow(socket, "activity:ludo:move", …)           — automatic rate limit
```

This fixes four things at once:
- Two plugins can both use `move` or `update` without colliding.
- Access control and rate limiting become **structural** instead of something each handler
  remembers — `whiteboard.handlers.js` currently repeats both by hand four times.
- A plugin cannot listen to another plugin's traffic; the namespace is bound at SDK construction.
- **`sockets/index.js` drops from 12 registrations to one dispatcher** — guarantee #1.

### 5.4 Event Bus — the only inter-plugin channel

```js
sdk.events.emit("activity.started", { players: 4 });   // namespaced to emitter; cannot be forged
sdk.events.on("activity.ended", (payload, meta) => { /* meta.source === "ludo" */ });
```

A **generic cross-plugin vocabulary** — `activity.started` / `ended` / `scored` / `saved` — is what
lets the room react to games that don't exist yet. It replaces today's hand-maintained `ACT_LABEL`
map: the room shows "started Ludo 🎲" because the manifest says `name: "Ludo"` and `icon: "🎲"`, not
because someone added a line to `RoomPage.jsx`.

The bus is per-room on each side and **does not bridge client and server** — crossing that gap goes
through `sdk.socket`, which is access-controlled. A bus that silently spanned both would be an
authorisation hole.

---

## 6. Recommendation engine (data-driven, no if/else)

Each manifest declares `recommendedFor: { purpose: weight }`. Scoring composes signals:

```
score = 1.00 * purposeFit(plugin, purpose)
      + 0.35 * cooccurrence(plugin, alreadySelected)     // "people who picked X also picked Y"
      + 0.15 * visibilityFit(plugin, visibility)
      + 0.25 * interestMatch(plugin, userInterests)
      + 0.10 * popularity                                 // tiebreaker only
```

Output: `{ id, score, tier: "recommended" | "optional", reasons: [...] }`. The reasons are generated
from whichever signals dominated — *"Popular for study rooms"*, *"Pairs well with Whiteboard"*.
Showing the reason is what makes a recommendation feel intentional rather than random, and it is
free once scoring is data-driven.

Tier by **relative** score (top-N above a fraction of the max), so a purpose with few strong matches
still yields a usable shortlist. The co-occurrence table ships as a static seed and can later be
recomputed from real install data — same interface, no code change.

---

## 7. Plugin catalogue — what to build, and in what order

Judged on: does it need infrastructure we lack, and does it earn its place in a hangout platform?

### v1 — wrap what exists (no new features)
`whiteboard` · `draw-guess` · `ludo` · `chess` · `uno` · `typing-race` · `bingo` · `smash-karts` · `poll`

### Tier 1 — cheap, high value, no new infrastructure
These need only the five v1 capabilities. Each is a genuinely small build on top of the plugin
system, which is the best possible proof the architecture works.

| Plugin | Why it earns a slot | Cost |
|---|---|---|
| **Sticky Notes / Mind Map** | reuses the whiteboard's sync + persist pattern almost exactly | small |
| **Kanban** | same CRDT-ish list sync; the most-requested "team" activity | small |
| **Timer / Pomodoro** | trivial shared countdown; makes study rooms actually useful | tiny |
| **Notes** | shared rich text; `sdk.storage` is already the whole backend | small |
| **Quiz / Flash Cards** | `lobbyGame.js` already does rounds, scoring and timers — this is a config over it | small |
| **Reaction Board** | ephemeral, no persistence; pure fun | tiny |
| **Word games** (Wordle-style, Codenames) | `lobbyGame.js` config; you already have `games/words.js` | small |

**Recommended first new plugin: Sticky Notes.** It exercises persistence, multi-user sync and the
config schema, and it's small enough that if the plugin API is wrong, you find out in a day rather
than a fortnight.

### Tier 2 — worth it, but need one new capability each
| Plugin | New capability needed |
|---|---|
| **Code Editor** (CodeMirror + Yjs) | none technically — but CRDT sync is real work; **the flagship plugin** |
| **Music Room** (shared queue + sync playback) | `sdk.media` for playback position sync; licensing means YouTube/self-hosted only |
| **AI Tutor / Facilitator / Debate** | `sdk.ai` — needs a free-tier LLM route (Groq/Gemini free tier fit your constraint) |
| **Watch Party** | `sdk.media`; already on your backlog |

### Tier 3 — defer
| Plugin | Why defer |
|---|---|
| **GitHub integration** | OAuth per user, token storage, rate limits — a project in itself |
| **Screen annotation** | needs to overlay the media layer, i.e. plugin↔core coupling we deliberately avoided |
| **Third-party / marketplace** | needs sandboxing (iframe or worker); Phase 7 seam only |

**Suggested build order after v1:** Sticky Notes → Kanban → Timer → Quiz → Code Editor → AI Tutor.
Small, real plugins first to validate the API; the flagship once it's proven.

---

## 8. Migration plan

Each phase ships independently and leaves the app working.

### Phase 1 — Foundation (no user-visible change)
`shared/activities/` scaffolding, manifest schema + validator, registry, manifests for the 9
existing activities, `Room` model additions, `compat.js` resolver.
Tests: manifest validation, legacy vs new resolution.
*Risk: very low — additive only, nothing reads it yet.*

### Phase 2 — Backend plugin host
1. `activities/host.js` — one dispatcher replacing 12 registrations.
2. Server SDK (socket, room, storage, presence, events) built from declared permissions.
3. **Migrate in this order**, each behind a parallel-registration flag so old and new run side by
   side until verified:
   ~~`whiteboard`~~ (server done; client still on socket.js) → ~~`poll`~~ **migrated in §47 and
   deliberately REVERTED in §48 — polls are core, see §0** → ~~the four framework games~~ ✅
   **done client+server in §50, via ONE adapter — one line per game, no per-game plugin code** →
   `draw-guess` → `ludo` → **`smash-karts` last**.

   §50 confirmed §1.2's prediction literally: because `lobbyGame.js` was already an SDK, extending
   it beat replacing it. The enabling refactor was splitting its **seat rules** (join/leave/start/
   reset/bots) out of its **transport** into `lobby.seats`, so the legacy registration and the
   plugin adapter share one implementation instead of two copies that drift.

   **The flag is per-plugin and so is the migration.** Enabling a plugin switches the *server* to
   the host; its *client* must already speak `sdk.socket`, or the two halves desynchronise and the
   activity dies silently. Whiteboard is the live example: server module done since Phase 2, but
   `WhiteboardPanel` still imports `socket.js`, so `ACTIVITY_PLUGINS=whiteboard` would break it.

   Poll also forced a real SDK addition: **`sdk.socket.detached()`**, a broadcaster that outlives the
   request, for plugins that must speak from a timer with no socket in scope. Every remaining
   timer-based plugin needs it — which is what migrating in size order is for.
4. Kart's `destroy()` clearing its `setInterval` physics loop is the reference lifecycle test.

*Risk: medium-high — this is where regressions live.* Mitigation: one plugin per commit, parallel
registration, existing socket tests pass untouched at every step.

### Phase 3 — Frontend runtime
`ActivityHost`, `createSdk`, event bus, error boundary, LRU mount cache, `onHidden`/`onShown`.
Tab bar generated from `installed[]` — deletes the hardcoded array at `RoomPage.jsx:546` and the
`ACT_LABEL`/`ACT_VIEW` maps at `:31-44`. `GamesHub` becomes a registry-driven category view.

*Risk: high — `RoomPage.jsx` is 1239 lines and holds last session's `h-screen`/`min-h-0` layout fix,
exactly the invariant a refactor breaks silently.* Mitigation: one extraction per commit; re-run the
CDP layout verification (`tabs-test.mjs`) after each.

### Phase 4 — Room creation wizard
Name → Visibility (+ `inviteOnly`) → Purpose cards → recommended activities → per-plugin config.
**Skippable after step 2** — one-click room creation must survive; forcing five steps would be a
downgrade from today's single field.
Server-side validation of client config against `configSchema` (same trust boundary as
`sanitizeAttachments()`).

### Phase 5 — Activity management in an existing room
Add/remove/reconfigure; per-activity permission (who may start it).

### Phase 6 — First new plugin: Sticky Notes ✅ DONE
The real test of guarantee #1: **if this touches any file outside `activities/sticky-notes/`, the
architecture failed** and gets fixed before anything else is built on it.

**Outcome: it failed, and the architecture was fixed first.** Three platform defects surfaced —
each invisible while whiteboard was the only non-game plugin, each a hard blocker for the second:

1. **`surface: "tab"` aliased onto `"board"`**, and `buildRoomView` took `bySurface("board")[0]` —
   so the second board-ish plugin was silently dropped. `tab` is now its own surface; each such
   plugin gets `tab:<id>`, a slot it cannot share.
2. **The tab bar was manifest-driven but the tab body was not** — Phase 3 deleted the hardcoded tab
   array and left `<WhiteboardPanel/>` hardcoded underneath. Tabs now carry the `activityId` they
   render and the shell mounts `<ActivityHost>`; RoomPage.jsx names no plugin at all.
3. **There was no client SDK.** The server had spoken `activity:join`/`activity:event` since Phase 2
   but nothing in the frontend ever spoke it — every panel still imported `socket.js` directly, so
   the whiteboard migration was server-side only. Built as platform:
   `frontend/src/activities/sdk.js` + `useActivitySdk.js`.

Also: `ACTIVITY_PLUGINS=none` meant "run the legacy handler instead", which for a plugin with *no*
legacy handler means silently dead. Native plugins (`NATIVE_PLUGIN_IDS`) are now always served.

Final footprint: 3 new files + 3 registration lines, zero edits to the dispatcher, wizard or
recommendation engine. Guarantee #1 is now enforced by a test that greps the shell files for the
plugin id, so it cannot quietly regress. See PROJECT_NOTES §46.

### Phase 7 — Marketplace seams (architecture only)
Version resolution, dependency graph, plugin state store interface (in-memory now, Redis later),
manifest signature hook.

---

## 9. Seams left open (no cost today)

| Future need | Seam | Cost now |
|---|---|---|
| Marketplace / third-party | registry accepts remote manifests; unknown id degrades | 0 |
| Sandboxing | error boundary + capability SDK + namespaced sockets | 0 (needed anyway) |
| AI-generated plugins | manifest is data; `configSchema` is a closed grammar | 0 |
| Paid plugins | `installed[]` subdoc has room for entitlement fields | 0 |
| Versioned plugins | `installed[].version` pinned at install | 1 field |
| Dependencies | `manifest.requires[]` + resolver | small |
| Horizontal scaling | plugin state behind an interface, not a bare `Map` | Phase 7 |

Note: server plugin state is currently an in-process `Map`, so it does not survive a restart or
scale horizontally. That is **pre-existing**, not introduced here — the plan just makes it a
swappable interface later.

---

## 10. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| RoomPage refactor breaks the fixed-header layout | high | CDP layout test per commit |
| Kart migration leaks its physics interval | medium | `destroy()` is the reference lifecycle test |
| Ludo/Kart/draw-guess take longer than the framework games | **high** | they are 3× the size and bespoke; schedule accordingly |
| Scope creep into new plugins mid-migration | high | freeze the catalogue at the existing 9 until Phase 3 lands |
| Bundle grows from registry | low | manifests are data-only; components stay `lazy()` |

---

## 11. Decision log

1. **Room core = chat, video, screen share, voice, presence, moderation.** Plugins occupy the Board
   and Game surfaces only.
2. **Five-capability SDK in v1** — no chat/video/AI, because nothing in scope needs them. Additive
   later without breaking anything.
3. **Registry holds manifests, not components** — preserves existing lazy loading.
4. **Capabilities absent, not denied** — mistakes fail at the plugin's own call site.
5. **Namespaced sockets** make access control and rate limiting structural.
6. **Event bus does not bridge client and server** — that gap is authorisation-relevant.
7. **Backward compat via resolver, not migration** — no batch job, fully reversible.
8. **`configSchema` is a closed grammar, not JSON Schema** — every valid schema renders.
9. **Mounted-but-hidden on tab switch** — preserves game state; requires `onHidden`/`onShown` for
   canvas plugins.
10. **Kart migrates last** — real-time loop, hardest lifecycle.
11. **Sticky Notes is the first new plugin** — smallest honest test of guarantee #1.
12. **Manifests are shared data** — one source of truth for wizard, engine and server.
