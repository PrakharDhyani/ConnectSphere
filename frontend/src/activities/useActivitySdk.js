/**
 * React binding for the client SDK.
 *
 * A plugin component calls `useActivitySdk("sticky-notes", roomId)` and gets a
 * built SDK plus the state the server handed back on join. Everything that is
 * easy to get wrong — joining after connect, rejoining after a reconnect,
 * removing listeners on unmount, not setting state on a dead component — is
 * done here once instead of in every plugin.
 *
 * WHY REJOIN ON RECONNECT IS NOT OPTIONAL
 * Socket.io rooms live on the server connection. A dropped connection leaves
 * the activity room, so after a reconnect the socket is connected but silently
 * receives nothing — the plugin looks alive and is deaf. The user sees a board
 * that has stopped updating and no error anywhere. Rejoining on the `connect`
 * event is what makes a reconnect self-healing.
 */
import { useEffect, useRef, useState } from "react";
import { connectSocket } from "@/lib/socket.js";
import { createClientSdk } from "./sdk.js";

/**
 * @param {string} activityId
 * @param {string} roomId
 * @param {object} [opts] { config, user, room }
 * @returns {{sdk, state, status, error, setState}}
 *   status: "connecting" | "ready" | "error"
 */
export function useActivitySdk(activityId, roomId, opts = {}) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);
  /**
   * The SDK is STATE, not a ref.
   *
   * It is built inside an effect, i.e. after the first render, and consumers
   * subscribe to broadcasts in their own `[sdk]` effect. A ref assignment does
   * not re-render, so those effects would run once with `sdk === null` and
   * never again — the board would load its initial state and then sit there
   * deaf to every update, with nothing in the console to say why.
   */
  const [sdk, setSdk] = useState(null);

  // Held in a ref so a changing config object does not tear down and rebuild
  // the SDK on every render — only activityId/roomId should do that.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!activityId || !roomId) return undefined;

    let cancelled = false;
    const socket = connectSocket();
    const sdk = createClientSdk({ activityId, roomId, ...optsRef.current });
    setSdk(sdk);

    const join = async () => {
      try {
        const initial = await sdk.socket.join();
        if (cancelled) return;
        setState(initial);
        setStatus("ready");
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err.message || "Could not open this activity");
      }
    };

    // A socket that is still handshaking has no rooms yet, so joining now would
    // be dropped. Waiting for `connect` covers both the first mount and every
    // later reconnect with the same handler.
    if (socket.connected) join();
    socket.on("connect", join);

    return () => {
      cancelled = true;
      socket.off("connect", join);
      sdk.destroy();
      setSdk(null);
      setStatus("connecting");
    };
  }, [activityId, roomId]);

  return { sdk, state, status, error, setState };
}
