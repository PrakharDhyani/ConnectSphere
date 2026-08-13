/**
 * Client side of Smash Karts. The server streams world snapshots at ~15 Hz —
 * far too fast to drive React re-renders — so live snapshots land in `snapRef`
 * (the canvas render loop reads it every frame). React state is only used for
 * coarse view changes: lobby ↔ playing ↔ ended, and the player list shown on
 * the lobby / scoreboard screens.
 *
 * MIGRATED TO THE ACTIVITY SDK (Phase 2, §54) — the last migration. Both halves
 * move together, as always: a client still on `kart:*` while the server module
 * is enabled would render an arena that never updates.
 *
 * The reconnect re-sync the legacy hook did by hand (`socket.on("connect",
 * sync)`) is gone: `useActivitySdk` rejoins the activity on every reconnect and
 * the join ack carries the snapshot, so catching up is the same code path as
 * arriving. That was a real bug class here — the arena can start AND end while
 * a player is disconnected.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useActivitySdk } from "@/activities/useActivitySdk.js";
import { getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { sfx } from "@/lib/sfx.js";

export function useKart(roomId) {
  const me = useAuthStore((s) => s.user);
  const { sdk, state } = useActivitySdk("kart", roomId);
  const snapRef = useRef({ prev: null, cur: null, at: 0 }); // for interpolation
  const killFeedRef = useRef([]); // [{ text, at }] — drawn on the canvas
  const boomsRef = useRef([]); // [{ x, y, at, consumed }] — bomb blasts to render
  const [status, setStatus] = useState("lobby");
  const [view, setView] = useState(null); // snapshot for lobby/ended UI
  // Errors from guarded actions surface in the UI instead of being swallowed
  // (a silent `{error}` ack looked exactly like "the button does nothing").
  const [error, setError] = useState(null);

  /** Fold one snapshot into the refs + coarse React state. */
  const absorb = useCallback((s) => {
    if (!s) return;
    // The 15Hz stream omits `pickups` when nothing changed (bandwidth) — carry
    // the last known list forward so the renderer always has one.
    if (!s.pickups && snapRef.current.cur?.pickups) s.pickups = snapRef.current.cur.pickups;
    snapRef.current = { prev: snapRef.current.cur, cur: s, at: performance.now() };
    setStatus((prev) => (prev !== s.status ? s.status : prev));
    // Only re-render the React tree when NOT mid-match (lobby/ended need the
    // live roster); during play the canvas owns everything.
    if (s.status !== "playing") setView(s);
  }, []);

  // The join ack (and every rejoin after a reconnect) is a full snapshot.
  useEffect(() => {
    if (!state) return;
    absorb(state);
    setView(state);
  }, [state, absorb]);

  useEffect(() => {
    if (!sdk) return undefined;

    const offState = sdk.socket.on("state", absorb);
    const offKill = sdk.socket.on("kill", ({ killerName, victimName }) => {
      killFeedRef.current.push({ text: `${killerName} 💥 ${victimName}`, at: performance.now() });
      if (killFeedRef.current.length > 5) killFeedRef.current.shift();
      // My own death sound comes from the hp/alive diff in the renderer.
      // (Read the store directly — no stale-closure dep on `me`.)
      if (killerName === useAuthStore.getState().user?.name) sfx.play("kill");
    });
    const offBoom = sdk.socket.on("boom", ({ x, y, big, freeze }) => {
      boomsRef.current.push({ x, y, big, freeze, consumed: false });
      if (boomsRef.current.length > 8) boomsRef.current.shift();
      sfx.play(freeze ? "freeze" : big === false ? "mineBlast" : "explosion");
    });

    return () => {
      offState();
      offKill();
      offBoom();
    };
  }, [sdk, absorb]);

  /** Await an ack and surface `{error}` into state rather than swallowing it. */
  const run = useCallback(
    async (event, payload) => {
      if (!sdk) return { error: "Not connected" };
      const res = await sdk.socket.emit(event, payload);
      setError(res?.error || null);
      return res;
    },
    [sdk]
  );

  const join = useCallback(() => run("join"), [run]);
  const leave = useCallback(() => sdk?.socket.post("leave"), [sdk]);
  const start = useCallback(async () => {
    const res = await run("start");
    // `room:announce` is CORE room traffic — it drives the tap-to-join toast
    // for people on another tab. Same precedent as §51/§52/§53.
    if (res?.ok) getSocket().emit("room:announce", { roomId, activity: "kart" });
    return res;
  }, [run, roomId]);
  const reset = useCallback(() => sdk?.socket.post("reset"), [sdk]);
  const addBot = useCallback((difficulty) => run("addBot", { difficulty }), [run]);
  const removeBot = useCallback((botId) => run("removeBot", { botId }), [run]);

  /**
   * The hot path: up to 40 input tuples a second.
   *
   * `post`, not `emit` — an ack per input would arm 40 timeouts a second for
   * results nobody reads, and a dropped input is superseded 25ms later. This is
   * exactly the case `sdk.socket.post()` was added for in §51.
   */
  const sendInput = useCallback((input) => sdk?.socket.post("input", { input }), [sdk]);
  const setConfig = useCallback((cfg) => sdk?.socket.post("config", cfg), [sdk]);
  const setTeam = useCallback(
    (playerId, team) => sdk?.socket.post("setTeam", { playerId, team }),
    [sdk]
  );

  const joined = Boolean(view?.players?.some((p) => p.id === me?.id));
  const isHost = view?.hostId === me?.id;

  return {
    sdk, me, status, view, snapRef, killFeedRef, boomsRef, joined, isHost, error,
    join, leave, start, reset, sendInput, setConfig, setTeam, addBot, removeBot,
  };
}
