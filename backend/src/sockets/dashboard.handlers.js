/**
 * Live room-activity feed for the dashboard.
 *
 * The dashboard wants to know what is happening inside rooms the user is NOT
 * currently in — that is the whole value of the card ("2 people are playing
 * Ludo" is an invitation; "3 members" is a filing cabinet). But the events that
 * would tell it are all scoped to inside a room: presence broadcasts go to
 * `room:<id>`, call state goes to `room:<id>`, activity joins go to
 * `act:<plugin>:<id>`. Someone sitting on the dashboard is in none of them.
 *
 * WHY A POLLED SUBSCRIPTION RATHER THAN HOOKING EVERY CHANGE POINT
 * The "correct" design is to emit on every presence/call/activity transition.
 * That means editing chat.handlers, media.handlers and the activity host, and
 * keeping three call sites in sync forever — and the failure mode when one is
 * missed is a card that is confidently wrong until the next refresh, which is
 * worse than a card that is a few seconds late.
 *
 * So instead: the dashboard says which rooms it is showing, and gets a snapshot
 * on an interval. One place to be right, and it CANNOT drift from reality
 * because it recomputes from socket.io membership every time rather than
 * accumulating state. The cost is a `fetchSockets()` sweep per tick for one
 * user's handful of rooms — cheap, bounded, and it stops the moment they
 * navigate away or disconnect.
 *
 * The tick is deliberately unhurried (4s). This is ambient information; nobody
 * is making a decision that needs sub-second accuracy, and a faster poll would
 * spend real CPU to move a number a couple of seconds sooner.
 */
import { roomActivitySnapshots } from "../services/roomActivity.service.js";
import { isRoomMember } from "../utils/roomAccess.js";
import { logger } from "../utils/logger.js";

const TICK_MS = 4000;
/** Nobody has a dashboard with 50 live rooms; the cap bounds the sweep. */
const MAX_WATCHED = 30;

export function registerDashboardHandlers(io, socket) {
  let timer = null;

  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  /**
   * `dashboard:watch { roomIds }` — start (or replace) this socket's watch.
   *
   * Membership is verified per room, not assumed from the request: the client
   * names the rooms, and without a check anyone could ask "who is in room X?"
   * for a room they have never joined. That would turn an ambient nicety into
   * a presence-tracking oracle for private rooms.
   */
  socket.on("dashboard:watch", async ({ roomIds } = {}, ack) => {
    try {
      stop();
      const requested = Array.isArray(roomIds) ? roomIds.slice(0, MAX_WATCHED).map(String) : [];
      if (requested.length === 0) return ack?.({ ok: true, rooms: {} });

      const allowed = [];
      for (const id of requested) {
        if (await isRoomMember(id, socket.user.id)) allowed.push(id);
      }
      if (allowed.length === 0) return ack?.({ ok: true, rooms: {} });

      const push = async () => {
        try {
          socket.emit("dashboard:activity", await roomActivitySnapshots(io, allowed));
        } catch (err) {
          logger.warn(`dashboard activity sweep failed: ${err.message}`);
        }
      };

      timer = setInterval(push, TICK_MS);
      // `unref` so a watching socket cannot hold the process open in tests.
      timer.unref?.();
      // Answer immediately as well, so the first paint does not wait a tick.
      const rooms = await roomActivitySnapshots(io, allowed);
      ack?.({ ok: true, rooms });
    } catch (err) {
      logger.error("dashboard:watch failed:", err);
      ack?.({ ok: false, error: "Could not watch rooms" });
    }
  });

  socket.on("dashboard:unwatch", () => stop());
  // A closed tab must not leave an interval sweeping sockets forever — the
  // same lifecycle obligation the activity host has for plugin timers.
  socket.on("disconnect", stop);
}
