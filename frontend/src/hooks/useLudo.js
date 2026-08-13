/**
 * Client state for Ludo.
 *
 * MIGRATED TO THE ACTIVITY SDK (Phase 2, §53). Was `socket.js` + `ludo:*`
 * events; now `sdk.socket` with the host routing by plugin id. Both halves must
 * move together — a client still on the legacy channel while the server module
 * is enabled desynchronises and the game dies silently.
 *
 * The hook is the whole transport surface, so migrating it migrated the game:
 * `LudoPanel` reads this hook's return value and its only other socket use is
 * room chat, which is core traffic and stays where it is.
 *
 * JOIN IS THE SYNC. `sdk.socket.join()` returns the server's state in its ack,
 * replacing the separate `ludo:sync` round-trip. Note that *opening* the game
 * does not seat you: `join()` here is the activity join (spectate), and taking
 * a coloured seat is the explicit `seat()` action below. Four seats are scarce,
 * so someone who opens the tab to watch must not consume one.
 */
import { useCallback, useEffect, useState } from "react";
import { useActivitySdk } from "@/activities/useActivitySdk.js";
import { getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { COLORS } from "@/games/ludoBoard.js";

export function useLudo(roomId) {
  const me = useAuthStore((s) => s.user);
  const { sdk, state, setState } = useActivitySdk("ludo", roomId);
  const [notices, setNotices] = useState([]); // AFK/system messages

  useEffect(() => {
    if (!sdk) return undefined;
    const offState = sdk.socket.on("state", (s) => setState(s));
    const offNotice = sdk.socket.on("notice", ({ text }) =>
      setNotices((n) => [...n.slice(-5), { id: `${Date.now()}-${Math.random()}`, text }])
    );
    return () => {
      offState();
      offNotice();
    };
  }, [sdk, setState]);

  /**
   * Take a coloured seat. Named `join` for the panel's sake — it is the same
   * action the legacy `ludo:join` performed — but it is a plugin EVENT, not the
   * activity join, which `useActivitySdk` already did on mount.
   */
  const join = useCallback(async () => {
    if (!sdk) return { error: "Not connected" };
    return sdk.socket.emit("join");
  }, [sdk]);

  const leave = useCallback(() => sdk?.socket.post("leave"), [sdk]);

  const start = useCallback(async () => {
    if (!sdk) return { error: "Not connected" };
    const res = await sdk.socket.emit("start");
    // `room:announce` is CORE room traffic, not plugin traffic — it drives the
    // tap-to-join toast for people looking at another tab. Same precedent as
    // WhiteboardPanel (§51) and useSkribbl (§52).
    if (res?.ok) getSocket().emit("room:announce", { roomId, activity: "ludo" });
    return res;
  }, [sdk, roomId]);

  const roll = useCallback(() => sdk?.socket.post("roll"), [sdk]);
  const move = useCallback((token) => sdk?.socket.post("move", { token }), [sdk]);
  const reset = useCallback(() => sdk?.socket.post("reset"), [sdk]);

  const addBot = useCallback(
    async (difficulty) => {
      if (!sdk) return { error: "Not connected" };
      return sdk.socket.emit("addBot", { difficulty });
    },
    [sdk]
  );
  const removeBot = useCallback(
    async (color) => {
      if (!sdk) return { error: "Not connected" };
      return sdk.socket.emit("removeBot", { color });
    },
    [sdk]
  );

  const myColor = state ? COLORS.find((c) => state.seats?.[c]?.id === me?.id) || null : null;
  const isMyTurn = state?.status === "playing" && state.turn === myColor && !state.winner;

  return { sdk, state, me, myColor, isMyTurn, join, leave, start, roll, move, reset, addBot, removeBot, notices };
}
