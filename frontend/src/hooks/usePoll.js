/**
 * Client half of in-room polls — now speaking the plugin SDK rather than raw
 * socket.js. PollPanel's interface is unchanged: `{ poll, create, vote, close }`.
 *
 * WHAT THE MIGRATION BUYS, CONCRETELY
 *
 * 1. The 400ms sleep is gone. This hook used to `setTimeout(..., 400)` before
 *    `poll:sync`, because sync required room membership and the room join was
 *    issued by useRoomChat on the same `connect` tick — so it raced, and the
 *    fix was to guess a delay. `sdk.socket.join()` IS the sync: one
 *    access-controlled round trip that returns the current poll in its ack, so
 *    there is nothing to race and no number to guess.
 *
 * 2. No roomId filtering on inbound events. The old `onState` had to check
 *    `p.roomId === roomId` because `poll:state` was a global event every socket
 *    heard. The namespaced socket delivers only this room's activity traffic,
 *    so the check is structural instead of remembered.
 *
 * 3. Reconnects re-join automatically (useActivitySdk re-runs join on
 *    `connect`), which is what the old `sync` on connect was approximating.
 */
import { useCallback, useEffect } from "react";
import { useActivitySdk } from "@/activities/useActivitySdk.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { getSocket } from "@/lib/socket.js";

export function usePoll(roomId) {
  const me = useAuthStore((s) => s.user);
  const { sdk, state, setState } = useActivitySdk("poll", roomId, { user: me });

  // The server is the only writer of poll state: every mutation is answered by
  // a `state` broadcast, so there is no optimistic copy to drift out of sync.
  const poll = state?.poll ?? null;

  // Subscribe to the one event this plugin broadcasts. Registered through the
  // sdk so it is torn down with it on unmount.
  useSubscribe(sdk, setState);

  const create = useCallback(
    async ({ question, options, durationSec }) => {
      const res = await sdk?.socket.emit("create", { question, options, durationSec });
      // Normalised to the shape PollPanel already expects ({ok} | {ok:false,error}),
      // so the migration stays invisible above this hook.
      if (res?.error) return { ok: false, error: res.error };
      // `room:announce` is CORE, not plugin traffic — it drives the room's
      // tap-to-join toast and every activity emits it (call, board, ludo…).
      // Dropping it during the migration would have silently removed "started
      // Polls 📊" for everyone not already looking at the room tab.
      getSocket().emit("room:announce", { roomId, activity: "poll" });
      return { ok: true };
    },
    [sdk, roomId]
  );

  const vote = useCallback(
    async (optionIdx) => {
      const res = await sdk?.socket.emit("vote", { optionIdx });
      return res?.error ? { ok: false, error: res.error } : { ok: true };
    },
    [sdk]
  );

  const close = useCallback(async () => {
    const res = await sdk?.socket.emit("close", {});
    return res?.error ? { ok: false, error: res.error } : { ok: true };
  }, [sdk]);

  return { poll, create, vote, close };
}

/**
 * Split out so the effect's dependencies are exactly [sdk] — inlining it above
 * would tempt a future edit into adding `poll` to the deps and re-subscribing
 * on every vote.
 */
function useSubscribe(sdk, setState) {
  useEffect(() => {
    if (!sdk?.socket) return undefined;
    return sdk.socket.on("state", ({ poll }) => setState({ poll }));
  }, [sdk, setState]);
}
