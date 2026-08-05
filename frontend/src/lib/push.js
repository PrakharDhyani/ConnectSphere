/**
 * Web Push plumbing: register the service worker, turn the server's VAPID
 * public key into a PushSubscription, and keep the backend in sync.
 *
 * Flow (see PushToggle.jsx for the UI):
 *   1. GET /push/key            — server's VAPID public key (null = feature off)
 *   2. Notification.requestPermission()
 *   3. pushManager.subscribe()  — browser talks to ITS OWN push relay
 *   4. POST /push/subscribe     — store the endpoint so the server can send
 */
import { api } from "@/lib/api.js";

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// Standard boilerplate: VAPID keys travel base64url, subscribe() wants bytes.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** Is this browser currently subscribed (regardless of who's logged in)? */
export async function getPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) || null;
}

/**
 * Full opt-in. Returns "subscribed" | "denied" | "unavailable".
 * "unavailable" = unsupported browser OR server without VAPID keys.
 */
export async function enablePush() {
  if (!pushSupported()) return "unavailable";
  const { data } = await api.get("/push/key");
  const publicKey = data?.data?.publicKey;
  if (!publicKey) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!reg) return "unavailable";
  await navigator.serviceWorker.ready;

  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await api.post("/push/subscribe", { subscription: subscription.toJSON() });
  return "subscribed";
}

export async function disablePush() {
  const sub = await getPushSubscription();
  if (!sub) return;
  await api.delete("/push/subscribe", { data: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
