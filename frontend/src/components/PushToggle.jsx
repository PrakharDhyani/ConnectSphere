import { useEffect, useState } from "react";
import { enablePush, disablePush, getPushSubscription, pushSupported } from "@/lib/push.js";
import { useNotify } from "@/stores/notify.store.js";

/**
 * 🔔 One-tap opt-in for Web Push ("a friend started Ludo in your room" — even
 * with the tab closed). Deliberately a small header bell, NOT an auto-prompt on
 * load: browsers punish (and users resent) permission dialogs they didn't ask
 * for. Hidden entirely when the browser can't do push.
 */
export default function PushToggle() {
  const push = useNotify((s) => s.push);
  const [state, setState] = useState("loading"); // loading | off | on | denied | unavailable
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return setState("unavailable");
    if (Notification.permission === "denied") return setState("denied");
    getPushSubscription().then((sub) => setState(sub ? "on" : "off"));
  }, []);

  if (state === "loading" || state === "unavailable") return null;

  async function toggle() {
    setBusy(true);
    try {
      if (state === "on") {
        await disablePush();
        setState("off");
        push({ title: "Notifications off" });
      } else {
        const result = await enablePush();
        setState(result === "subscribed" ? "on" : result === "denied" ? "denied" : "off");
        if (result === "subscribed") push({ title: "🔔 You'll be pinged when friends start something" });
        if (result === "unavailable") push({ title: "Push isn't configured on this server yet" });
      }
    } catch {
      push({ title: "Could not update notifications" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || state === "denied"}
      title={
        state === "denied"
          ? "Notifications are blocked in your browser settings"
          : state === "on"
            ? "Notifications on — click to disable"
            : "Get notified when friends start an activity"
      }
      className={`text-lg leading-none transition-transform hover:scale-110 disabled:opacity-40 ${
        state === "on" ? "" : "grayscale opacity-60 hover:opacity-100"
      }`}
    >
      {state === "denied" ? "🔕" : "🔔"}
    </button>
  );
}
