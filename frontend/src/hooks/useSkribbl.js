/**
 * Client state for the draw-and-guess game.
 *
 * MIGRATED TO THE ACTIVITY SDK (Phase 2). This hook used to import
 * `socket.js` and speak `game:*` events directly; it now speaks
 * `sdk.socket` and the host routes by plugin id. The two halves must move
 * together — a client still on `socket.js` while the server module is enabled
 * (or the reverse) desynchronises and the game dies silently, which is exactly
 * the failure the per-plugin flag exists to make reversible.
 *
 * WHY THE SOCKET CODE LIVES HERE AND NOT IN GamePanel
 * The panel is presentation; this hook is the whole transport surface. That
 * split is what made the migration a one-file change on the client: GamePanel
 * and GameCanvas were already written against this hook's return value, so
 * they did not need to know the wire format changed at all. GameCanvas is the
 * one exception — it owns the canvas and therefore the draw/clear stream — so
 * it now takes its two senders from here rather than reaching for the socket.
 *
 * JOIN IS THE SYNC. The old code emitted `game:join` and then `game:sync` to
 * catch up. `sdk.socket.join()` returns the server's state in its ack, so the
 * separate round-trip is gone — one message, no window where the UI is mounted
 * but stateless.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useActivitySdk } from "@/activities/useActivitySdk.js";
import { getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { sfx } from "@/lib/sfx.js";

export function useSkribbl(roomId) {
  const me = useAuthStore((s) => s.user);
  const { sdk, state, setState, status, error } = useActivitySdk("skribbl", roomId);
  const [choices, setChoices] = useState(null); // drawer: 3 words to pick from
  const [myWord, setMyWord] = useState(null); // drawer: the chosen word
  const [feed, setFeed] = useState([]);
  const [spectating, setSpectating] = useState(false); // joined mid-round

  /**
   * Status transitions drive the sound effects, so the previous status has to
   * survive a re-render. A ref, not state: nothing renders from it, and making
   * it state would re-run this effect on every transition it just handled.
   */
  const lastStatus = useRef(null);

  // The join ack carries `spectate` alongside the state (see server onJoin).
  useEffect(() => {
    if (state?.spectate !== undefined) setSpectating(Boolean(state.spectate));
  }, [state?.spectate]);

  useEffect(() => {
    if (!sdk) return undefined;

    const offState = sdk.socket.on("state", (s) => {
      // Round-start blip on the choosing→drawing transition; fanfare at the end.
      if (lastStatus.current !== null && lastStatus.current !== s.status) {
        if (s.status === "drawing") sfx.play("roundStart");
        if (s.status === "ended") sfx.play("win");
      }
      lastStatus.current = s.status;
      setState(s);
    });

    const offChoices = sdk.socket.on("choices", ({ choices: c }) => setChoices(c));
    const offDrawerWord = sdk.socket.on("drawerWord", ({ word }) => setMyWord(word));
    const offCorrect = sdk.socket.on("correct", ({ name, userId }) => {
      sfx.play(userId === me?.id ? "correct" : "tick");
      setFeed((f) => [...f, { type: "correct", name, mine: userId === me?.id }].slice(-60));
    });
    const offGuessMessage = sdk.socket.on("guessMessage", ({ name, text }) =>
      setFeed((f) => [...f, { type: "guess", name, text }].slice(-60))
    );
    const offTurnEnd = sdk.socket.on("turnEnd", ({ word }) =>
      setFeed((f) => [...f, { type: "reveal", word }].slice(-60))
    );

    return () => {
      offState();
      offChoices();
      offDrawerWord();
      offCorrect();
      offGuessMessage();
      offTurnEnd();
    };
  }, [sdk, me?.id, setState]);

  /**
   * Drawer-only state is cleared when the turn moves on.
   *
   * Kept out of the `state` listener so it also runs for the state that arrives
   * in the join ack — a spectator who joins mid-round must not keep a stale
   * word from a turn they were the drawer of.
   */
  useEffect(() => {
    if (!state) return;
    if (state.drawerId !== me?.id) {
      setChoices(null);
      setMyWord(null);
    }
    if (state.status !== "choosing") setChoices(null);
    if (state.status === "idle" || state.status === "ended") {
      setMyWord(null);
      setFeed([]);
    }
  }, [state, me?.id]);

  /**
   * A spectator claims a seat the moment the round closes out.
   *
   * Re-joining is how the server moves someone from spectator to player, and
   * the fresh ack replaces the state — so this must not run while a round is
   * live or it would reset the board mid-turn.
   */
  useEffect(() => {
    if (!sdk || !spectating) return;
    if (state?.status !== "lobby" && state?.status !== "ended") return;
    let cancelled = false;
    sdk.socket.join().then((s) => {
      if (cancelled || !s) return;
      setSpectating(Boolean(s.spectate));
      setState(s);
    });
    return () => { cancelled = true; };
  }, [sdk, spectating, state?.status, setState]);

  const start = useCallback(
    async (rounds = 3) => {
      if (!sdk) return { error: "Not connected" };
      const res = await sdk.socket.emit("start", { rounds });
      // `room:announce` is CORE room traffic, not plugin traffic — it drives the
      // tap-to-join toast for people who are not looking at the game tab. Same
      // precedent as WhiteboardPanel: the plugin SDK deliberately cannot send it.
      if (res?.ok) getSocket().emit("room:announce", { roomId, activity: "skribbl" });
      return res;
    },
    [sdk, roomId]
  );

  const setReady = useCallback((ready) => sdk?.socket.post("ready", { ready }), [sdk]);
  const chooseWord = useCallback((word) => sdk?.socket.post("chooseWord", { word }), [sdk]);
  const guess = useCallback((text) => sdk?.socket.post("guess", { text }), [sdk]);

  /**
   * The canvas stream. `post`, not `emit` — strokes are high-rate and
   * best-effort, and arming an ack timeout per segment would leak timers for
   * results nobody reads (see the client SDK's note on post vs emit).
   */
  const draw = useCallback((stroke) => sdk?.socket.post("draw", { stroke }), [sdk]);
  const clear = useCallback(() => sdk?.socket.post("clear"), [sdk]);
  const onDraw = useCallback((fn) => sdk?.socket.on("draw", fn), [sdk]);
  const onClear = useCallback((fn) => sdk?.socket.on("clear", fn), [sdk]);

  const isDrawer = Boolean(state && state.drawerId === me?.id);
  const iGuessed = Boolean(state?.guessed?.includes(me?.id));

  return {
    state,
    choices,
    myWord,
    feed,
    isDrawer,
    iGuessed,
    me,
    spectating,
    status,
    error,
    start,
    setReady,
    chooseWord,
    guess,
    // Canvas transport, handed to GameCanvas so it never touches a socket.
    draw,
    clear,
    onDraw,
    onClear,
  };
}
