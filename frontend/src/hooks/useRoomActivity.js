/**
 * Live "what's happening in my rooms" for the dashboard cards.
 *
 * The server recomputes from socket.io membership on a slow tick rather than
 * pushing on every transition — see sockets/dashboard.handlers.js for why. This
 * hook subscribes for the rooms currently on screen and merges the snapshots
 * over whatever the REST list already returned, so the first paint is truthful
 * and then stays live.
 */
import { useEffect, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";

/**
 * @param {string[]} roomIds  rooms currently rendered
 * @returns {Record<string, {present, inCall, activities, headline}>}
 */
export function useRoomActivity(roomIds) {
  const [activity, setActivity] = useState({});

  /**
   * The dependency is the JOINED IDS, not the array.
   *
   * A fresh array literal every render would re-subscribe on every render —
   * a socket emit per keystroke elsewhere on the page. Comparing the contents
   * means the watch is replaced only when the set of rooms actually changes.
   */
  const key = (roomIds || []).join(",");

  useEffect(() => {
    if (!key) {
      setActivity({});
      return undefined;
    }
    const ids = key.split(",");
    const socket = connectSocket();
    let live = true;

    const onActivity = (rooms) => {
      if (live) setActivity(rooms || {});
    };
    socket.on("dashboard:activity", onActivity);

    const watch = () =>
      socket.emit("dashboard:watch", { roomIds: ids }, (res) => {
        if (live && res?.ok) setActivity(res.rooms || {});
      });

    if (socket.connected) watch();
    // Re-watch after a reconnect: the server's interval died with the old
    // connection, so without this the cards would silently freeze.
    socket.on("connect", watch);

    return () => {
      live = false;
      socket.off("dashboard:activity", onActivity);
      socket.off("connect", watch);
      // Stop the server-side sweep as soon as the dashboard is gone.
      getSocket()?.emit("dashboard:unwatch");
    };
  }, [key]);

  return activity;
}
