/**
 * Client twin of the backend lobby-game framework: one hook drives chess, UNO,
 * typing and bingo — now over the plugin SDK rather than raw socket.js.
 *
 * WHY ONE HOOK MIGRATES FOUR GAMES
 * Same reason one adapter serves them on the server: the four games were always
 * thin configs over a shared framework, so the shared piece is the only thing
 * that has to change. `ChessPanel`, `UnoPanel`, `TypingPanel` and `BingoPanel`
 * are untouched — the returned API is identical.
 *
 * WHAT CHANGED UNDERNEATH
 *   - `<prefix>:state` → `activity:<id>:state`, delivered only to sockets that
 *     joined this activity in this room. The event namespace is bound at SDK
 *     construction, so one game cannot hear another's traffic.
 *   - The explicit `sync` round trip on connect is now `join()`, whose ack IS
 *     the current table. Reconnects re-join automatically (useActivitySdk), so
 *     a dropped connection heals instead of leaving a board that has silently
 *     stopped updating.
 *   - Access control, rate limiting and the installed-activity check are the
 *     host's, applied before any handler runs.
 *
 * The `prefix` argument is kept and used as the plugin id — they are the same
 * string for all four games ("chess", "uno", "typing", "bingo"), so no caller
 * changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { useActivitySdk } from "@/activities/useActivitySdk.js";

export function useLobbyGame(prefix, roomId, extraEvents = {}) {
  const me = useAuthStore((s) => s.user);
  const { sdk, state: joined } = useActivitySdk(prefix, roomId, { user: me });

  const [state, setState] = useState(null);
  const [priv, setPriv] = useState(null); // your secret slice (hand, card…)
  const [notices, setNotices] = useState([]);
  const extraRef = useRef(extraEvents);
  extraRef.current = extraEvents;

  // The join ack carries the table as it stands — including `you`, the private
  // slice a late joiner needs and which no broadcast will resend.
  useEffect(() => {
    if (!joined) return;
    setState(joined);
    if (joined.you) setPriv(joined.you);
  }, [joined]);

  useEffect(() => {
    if (!sdk?.socket) return undefined;
    const offs = [
      sdk.socket.on("state", (s) => setState(s)),
      sdk.socket.on("private", (p) => setPriv(p)),
      sdk.socket.on("notice", ({ text }) =>
        setNotices((n) => [...n.slice(-5), { id: `${Date.now()}-${Math.random()}`, text }])
      ),
    ];
    // Per-game extras (chess clock ticks, bingo calls) — subscribed through the
    // sdk so they are torn down with everything else.
    for (const name of Object.keys(extraRef.current)) {
      offs.push(sdk.socket.on(name, (payload) => extraRef.current[name]?.(payload)));
    }
    return () => offs.forEach((off) => off());
  }, [sdk]);

  /**
   * Normalised to the `{ok} | {error}` shape the panels already expect, so the
   * migration stays invisible above this hook.
   */
  const emitAck = useCallback(
    async (event, payload = {}) => {
      if (!sdk?.socket) return { error: "Not connected" };
      const res = await sdk.socket.emit(event, payload);
      return res?.error ? { error: res.error } : { ok: true, ...res };
    },
    [sdk]
  );

  const join = useCallback(() => emitAck("join"), [emitAck]);
  const leave = useCallback(() => emitAck("leave"), [emitAck]);
  const start = useCallback(
    () =>
      emitAck("start").then((res) => {
        // `room:announce` is CORE room traffic, not plugin traffic — it drives
        // the tap-to-join toast for people who are not looking at this tab.
        if (res?.ok) getSocket().emit("room:announce", { roomId, activity: prefix });
        return res;
      }),
    [emitAck, prefix, roomId]
  );
  const reset = useCallback(() => emitAck("reset"), [emitAck]);
  const addBot = useCallback((difficulty) => emitAck("addBot", { difficulty }), [emitAck]);
  const removeBot = useCallback((botId) => emitAck("removeBot", { botId }), [emitAck]);
  const act = useCallback((event, payload) => emitAck(event, payload), [emitAck]);

  const seated = Boolean(state?.players?.some((p) => p.id === me?.id));
  const isHost = state?.hostId === me?.id;

  // `sdk` is returned so a panel can hand it to useReactions(), which sends on
  // the namespaced channel when it has one and the legacy channel when it does
  // not — the same hook still serves the unmigrated games.
  return { me, sdk, state, priv, notices, seated, isHost, join, leave, start, reset, addBot, removeBot, act };
}
