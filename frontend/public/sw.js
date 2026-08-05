/* global self, clients */
/**
 * Groot service worker — Web Push only (no offline caching yet).
 *
 * The page can't hear pushes when it's closed; this worker can. It renders the
 * payload sent by backend/src/services/push.service.js:
 *   { title, body?, url?, tag? }
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data?.text() };
  }
  const title = data.title || "Groot";

  event.waitUntil(
    (async () => {
      // If the user is already looking at the target page, a system banner is
      // just noise — the in-app toast already covers that case.
      const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const url = data.url || "/";
      const focusedOnTarget = wins.some((w) => w.focused && new URL(w.url).pathname === url);
      if (focusedOnTarget) return;

      await self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag || undefined, // same tag → replaces, so repeats don't stack
        icon: "/logo.svg",
        badge: "/logo.svg",
        data: { url },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer an existing tab: navigate + focus it rather than spawning tabs.
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w && new URL(w.url).pathname !== url) await w.navigate(url);
          return;
        }
      }
      await clients.openWindow(url);
    })()
  );
});
