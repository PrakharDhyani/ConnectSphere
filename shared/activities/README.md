# `shared/activities` — the Activity Plugin contract

Plain ESM, **no imports, no build step, no dependencies**. Both the backend (relative import) and
the frontend (via the `@shared` Vite alias) read these files, so they must stay runnable as-is in
Node and in the browser.

## Why this directory exists

The room-creation wizard, the recommendation engine and the server's permission check all need the
same facts about a plugin: what it is called, what it may do, what it can be configured with. Two
copies of that would drift. One shared, data-only source cannot.

## What is here

| File | Purpose |
|---|---|
| `manifest.js` | the manifest contract + `validateManifest()` |
| `registry.js` | `registerPlugin` / `getPlugin` / `getPluginsByCategory` / … |
| `purposes.js` | the room-purpose taxonomy used by the wizard |
| `config-schema.js` | the closed six-type config grammar + validation/coercion |
| `compat.js` | legacy-room resolution (rooms created before plugins existed) |
| `<id>/manifest.js` | one manifest per activity |
| `index.js` | registers every built-in manifest; import this once at boot |

## What is NOT here

No React components, no socket handlers, no server code. The registry holds **manifests only** —
registering implementations would drag every plugin into the initial bundle and destroy the lazy
loading the app depends on (Excalidraw alone is ~1.8 MB).

Implementations live at:
- `frontend/src/activities/<id>/index.jsx` — React component, `lazy()`-loaded on first mount
- `backend/src/activities/<id>/server.js` — socket handlers, loaded at boot

## Adding a plugin

1. `shared/activities/<id>/manifest.js` — the manifest
2. register it in `shared/activities/index.js`
3. implementation in the frontend/backend paths above

**That is the whole list.** If adding a plugin ever requires editing `sockets/index.js`,
`RoomPage.jsx` or `GamesHub.jsx`, the architecture has regressed and that is a bug to fix before
building anything else on top of it.
