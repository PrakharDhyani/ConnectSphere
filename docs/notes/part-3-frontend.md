# Part 3 — Frontend (React), file by file

> This part starts small — the scaffold as it exists today — and **grows with every
> feature**, since from now on each feature ships backend + frontend together.
> First feature up: the **Auth UI** (login/register/verify/reset + session handling).

---

## 1. The stack, and why each piece

| Package | What it is | Why it's here |
|---|---|---|
| **React 18** | UI library — the page is a tree of components re-rendered from state | Industry default, huge ecosystem |
| **Vite 6** | Dev server + build tool | Instant startup & hot reload (esbuild-based); v6 = the security-patched line we verified (see PROJECT_NOTES §5 — "latest" isn't the goal, *patched + compatible + verified* is) |
| **react-router-dom 6** | Client-side routing | URL ↔ component mapping without full page loads |
| **@tanstack/react-query 5** | **Server state** — data that lives on the backend (caching, refetching, loading/error states) | Kills 90% of hand-written `useEffect`+`fetch`+`isLoading` boilerplate |
| **zustand 4** | **Client state** — small global store | Where the in-memory access token + current user will live; ~1kB, no boilerplate |
| **axios** | HTTP client | Interceptors — the hook where we'll auto-attach the access token and auto-refresh on 401 |
| **react-hook-form + zod + @hookform/resolvers** | Forms + schema validation | Client-side mirror of the backend's Joi rules; zod schema drives field errors |
| **socket.io-client** | Real-time | For chat/rooms later |
| **Tailwind CSS 3** | Utility-class styling | Styles live in the JSX; `brand` purple palette configured |
| **framer-motion** | Animations | Later polish |
| **clsx + tailwind-merge** | Class-string helpers | Conditional classes that don't conflict |

**Server state vs client state** (the mental model): "list of rooms" is *server*
state → react-query. "Current access token" / "is the sidebar open" is *client*
state → zustand. Different tools on purpose.

---

## 2. The scaffold, file by file

### [index.html](../../frontend/index.html)
The **only** HTML page (this is what SPA — Single-Page Application — means).
It has an empty `<div id="root">` and one `<script type="module" src="/src/main.jsx">`.
React takes over from there; "pages" are components swapped by the router, not
separate HTML files.

### [vite.config.js](../../frontend/vite.config.js)
Three jobs:
1. `plugins: [react()]` — teaches Vite to transform JSX.
2. **Alias** `@` → `./src`, so imports read `@/pages/HomePage.jsx` instead of
   `../../pages/...` — survives moving files around.
3. **The dev proxy** — the FE↔BE bridge (full story in Part 1 §5): anything the
   app requests under `/api` or `/socket.io` (WebSockets included, `ws: true`) is
   forwarded to `http://localhost:5000`. The app only ever uses *relative* URLs;
   no CORS, and cookies behave as same-site.

### [src/main.jsx](../../frontend/src/main.jsx)
The entry point. Mounts `<App/>` into `#root`, wrapped in three providers
(a **provider** makes a capability available to every component beneath it):
- `React.StrictMode` — dev-only extra checks (double-invokes effects to expose bugs).
- `BrowserRouter` — enables routing.
- `QueryClientProvider` — react-query's cache (`staleTime: 5min` = data is
  trusted for 5 minutes before background refetch; `retry: 1` = one retry on
  failure).

### [src/App.jsx](../../frontend/src/App.jsx)
The route table: `/` → HomePage, `*` (anything else) → NotFoundPage. The
commented-out routes are the roadmap: `/login`, `/register` (this feature!),
then `/dashboard` behind a `ProtectedRoute`, `/room/:roomId`.

### [src/pages/HomePage.jsx](../../frontend/src/pages/HomePage.jsx) / NotFoundPage.jsx
Placeholder pages. ⚠️ **Bug found while writing these notes:** `NotFoundPage.jsx`
was an **empty file** while `App.jsx` imports it as a default export — the app
crashes at load ("does not provide an export named 'default'"). It worked
unnoticed because nobody had run the frontend since scaffolding. Fixed as part of
the Auth UI feature. *Lesson: a scaffold you never ran is a scaffold that doesn't work.*

### [src/index.css](../../frontend/src/index.css)
The three `@tailwind` directives (Tailwind's injection points: reset/base,
component classes, utilities) + global dark theme (`bg-gray-950`, white text).

### [tailwind.config.js](../../frontend/tailwind.config.js)
`content` tells Tailwind which files to scan — it only ships CSS for classes it
actually finds there (that's why the bundle stays tiny). `theme.extend` adds the
`brand` purple scale (`brand-500 = #8b5cf6`) and the Inter font stack.

### [postcss.config.js](../../frontend/postcss.config.js)
Plumbing: runs Tailwind as a PostCSS plugin + autoprefixer (adds `-webkit-` etc.
for older browsers). You never touch this file.

### [eslint.config.js](../../frontend/eslint.config.js)
ESLint 9 flat config with the React + react-hooks plugins (hooks rules catch real
bugs like conditional `useState`). Same ESLint-9 upgrade story as the backend
(PROJECT_NOTES §3).

---

## 3. Feature: Auth UI — the plan (next up)

Backend auth is complete and tested; this builds its missing half. It also
establishes the three FE patterns **every** later feature reuses: the API layer,
the auth store, and protected routes.

### The critical design: where tokens live in the browser

Decided back in the backend design (Part 2 §6), now implemented FE-side:

- **Access token → JavaScript memory only** (zustand store). Never localStorage —
  any XSS can read localStorage; it can't read a variable it doesn't know about,
  and it definitely can't read an httpOnly cookie.
- **Refresh token → httpOnly cookie** — the browser attaches it to
  `/api/auth/refresh` automatically; page JS never sees it.
- **Page reload** wipes memory → on app boot, silently call `/refresh` once: if
  the cookie is valid we're logged back in (get a fresh access token + user via
  `/users/me`); if not, we're logged out. No flash of the wrong state: show a
  loading screen until this "bootstrap" resolves.

### What gets built

```
src/
├── lib/api.js            axios instance (baseURL /api) + interceptors:
│                         → attach Authorization: Bearer <token> from the store
│                         → on 401: call /refresh once, retry the request;
│                           if refresh fails → clear store → redirect /login
├── stores/auth.store.js  zustand: { user, accessToken, setAuth, clearAuth }
├── components/
│   ├── ProtectedRoute.jsx  no user? → <Navigate to="/login"> (after bootstrap)
│   └── ui/                 Input, Button, form error text (Tailwind)
├── pages/
│   ├── LoginPage.jsx        react-hook-form + zod; error handling for 401
│   ├── RegisterPage.jsx     zod mirror of backend password policy
│   ├── AuthCallbackPage.jsx lands here after Google → calls /refresh → dashboard
│   ├── EmailVerifiedPage.jsx reads ?status=success/invalid from the redirect
│   ├── ForgotPasswordPage.jsx / ResetPasswordPage.jsx (?token=…)
│   └── DashboardPage.jsx    minimal protected page proving the loop closes
└── App.jsx                  all routes wired, dashboard behind ProtectedRoute
```

### How it maps to the backend endpoints

| FE piece | BE endpoint |
|---|---|
| RegisterPage | `POST /api/auth/register` |
| LoginPage | `POST /api/auth/login` |
| Google button | plain `<a href="/api/auth/google">` (full-page redirect — OAuth can't be a fetch) |
| AuthCallbackPage | `POST /api/auth/refresh` (cookie was set server-side during the redirect) |
| EmailVerifiedPage | landing page for the backend's `GET /verify-email` redirect |
| Forgot/ResetPasswordPage | `POST /forgot-password` / `POST /reset-password` |
| Logout button | `POST /api/auth/logout` + `clearAuth()` |
| Silent bootstrap / 401 retry | `POST /api/auth/refresh` |

### How it was actually built (file-by-file details: [feature-map F10](feature-map.md))

The plan above was implemented as designed. The pieces worth understanding deeply:

**The auth store** (`stores/auth.store.js`) has a third state besides
logged-in/logged-out: **`status: "loading"`**. On a hard reload the app cannot
know yet whether you're logged in (the cookie is invisible to JS!) — it has to
ask the server. Until that answer arrives, protected pages show a spinner.
Without this three-state design you get the classic SPA bug: logged-in users
see the login page flash on every reload.

**The interceptors** (`lib/api.js`) hide token mechanics from every future
feature. Any component just calls `api.get("/rooms")`; attaching the
Authorization header and recovering from expiry happen invisibly. Two
subtleties:
- **Single-flight refresh:** refresh tokens are single-use (rotation!). If five
  requests 401 simultaneously and each fired its own `/refresh`, the first
  would rotate the token and the other four would kill the session. So all
  callers share one in-flight refresh promise.
- **No retry for `/auth/*` URLs:** a 401 from login means "wrong password" —
  refreshing wouldn't help, and retrying would double-submit forms.

**Google button is an `<a>`, not a fetch** — OAuth is a chain of full-page
redirects; the browser must physically navigate away to Google and back.

### Verification

`npm run lint` clean · `npm run build` clean (342 kB JS, 169 modules).
Live end-to-end verification against the running backend (register → cookie →
reload-restores-session → verify link → reset flow) is the next session's first
task — it needs Docker (Mongo/Redis/MailDev) up.

### Challenges
- **`NotFoundPage.jsx` was an empty file** while `App.jsx` imported its default
  export — the scaffold frontend crashed on load and nobody knew, because it had
  never been run. *A scaffold you never ran is a scaffold that doesn't work.*
- react/no-unescaped-entities: JSX won't take a raw `'` in text (`isn't` →
  `isn&apos;t`) — tiny, but it fails CI lint.
