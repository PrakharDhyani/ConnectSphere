/**
 * Polls — second activity migrated to the plugin host.
 *
 * Compare with sockets/poll.handlers.js (131 lines): the canAccessRoom call,
 * the socket.rooms membership check repeated in three handlers, the two allow()
 * rate limits, and the roomKey() broadcast plumbing are all gone. The host does
 * them. What is left is what a poll actually is.
 *
 * WHY POLL IS THE RIGHT SECOND MIGRATION
 * It is the first plugin with a TIMER. A poll can auto-close after a duration,
 * so its destroy() must clear a pending setTimeout or a closed room leaves a
 * callback holding its state alive. That is the same failure mode as Kart's
 * setInterval physics loop, at a fraction of the size — a rehearsal for the
 * hard one, which is exactly why the migration order puts it here.
 *
 * WHY STATE IS STILL A MODULE-LEVEL Map RATHER THAN sdk.storage
 * Deliberate, and the opposite of the Sticky Notes decision. Polls are
 * explicitly ephemeral — "a poll that outlives the hangout has no value", per
 * the original handler — so persisting them would CHANGE behaviour, not
 * preserve it. sdk.storage writes through to Mongo; that is the wrong semantics
 * here. A migration should move where code lives, not quietly alter what it does.
 *
 * SURFACE: "overlay" — PollPanel renders inline beside chat rather than owning
 * a tab, so this plugin never appears in the tab bar.
 */
import { BUS_EVENTS } from "../eventBus.js";

// roomId → { id, question, options, votes, createdBy, closed, endsAt, timer }
const polls = new Map();

const MAX_QUESTION = 200;
const MAX_OPTION = 80;
const HARD_MAX_OPTIONS = 6;   // ceiling regardless of config
const MIN_DURATION = 15;
const MAX_DURATION = 600;

/**
 * The client-visible shape of a poll. Voter names are included because the UI
 * shows who voted for what — this is a hangout poll, not a secret ballot.
 */
function serialize(roomId) {
  const p = polls.get(roomId);
  if (!p) return null;
  return {
    id: p.id,
    question: p.question,
    closed: p.closed,
    endsAt: p.endsAt || null,
    createdBy: p.createdBy,
    totalVotes: p.votes.size,
    options: p.options.map((o, i) => {
      const voters = [...p.votes.entries()]
        .filter(([, v]) => v.idx === i)
        .map(([id, v]) => ({ id, name: v.name }));
      return { text: o.text, count: voters.length, voters };
    }),
  };
}

/**
 * Close a poll and tell the room.
 *
 * Takes a DETACHED broadcaster rather than an sdk, because the auto-close path
 * fires from a timer with no socket in scope. `sdk.socket.detached()` is the
 * capability for exactly this: it can reach this plugin in this room and
 * nothing else, and it stays valid after the request that created it is gone.
 */
function closePoll(wire, roomId) {
  const p = polls.get(roomId);
  if (!p || p.closed) return;
  p.closed = true;
  p.endsAt = null;
  clearTimeout(p.timer);
  p.timer = null;
  wire.broadcast("state", { poll: serialize(roomId) });
}

export default {
  /** Late joiners and reconnects get the current poll, if any. */
  async onJoin(sdk) {
    return { poll: serialize(sdk.room.id) };
  },

  rates: {
    // Creating a poll is a deliberate, disruptive act; voting is not.
    create: { max: 3, windowMs: 60_000 },
    vote: { max: 10, windowMs: 10_000 },
    close: { max: 10, windowMs: 60_000 },
  },

  events: {
    create(sdk, { question, options, durationSec } = {}, ack) {
      const q = String(question || "").trim();
      const opts = (Array.isArray(options) ? options : [])
        .map((o) => String(o || "").trim())
        .filter(Boolean);

      // Config can only TIGHTEN the ceiling, never raise it past what the
      // server is willing to serialize.
      const cap = Math.min(HARD_MAX_OPTIONS, sdk.meta.config.maxOptions || HARD_MAX_OPTIONS);

      if (!q || q.length > MAX_QUESTION) return ack?.({ error: "Question is required (max 200 chars)" });
      if (opts.length < 2 || opts.length > cap) return ack?.({ error: `Give 2–${cap} options` });
      if (opts.some((o) => o.length > MAX_OPTION)) return ack?.({ error: "Options max 80 chars" });

      // The one genuinely NEW capability the migration buys: the room can
      // restrict polls to its owner. The old handler had no way to express it.
      if (sdk.meta.config.anyoneCanCreate === false && !sdk.room.isOwner(sdk.user.id)) {
        return ack?.({ error: "Only the room owner can start a poll here" });
      }

      const existing = polls.get(sdk.room.id);
      if (existing && !existing.closed) return ack?.({ error: "A poll is already running" });
      if (existing) clearTimeout(existing.timer);

      // 0 = no timer; otherwise clamp so a typo cannot pin a poll open forever.
      const requested = Number(durationSec);
      const dur = Math.min(MAX_DURATION, Math.max(0, Number.isFinite(requested) ? requested : 0));
      const poll = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question: q,
        options: opts.map((text) => ({ text })),
        votes: new Map(),
        createdBy: { id: sdk.user.id, name: sdk.user.name },
        closed: false,
        endsAt: dur >= MIN_DURATION ? Date.now() + dur * 1000 : null,
        timer: null,
      };
      polls.set(sdk.room.id, poll);
      if (poll.endsAt) {
        // Captured NOW: the timer fires long after this handler returns, when
        // the sdk's socket is gone. The detached broadcaster is the only part
        // of the sdk that is safe to hold onto past the request.
        const wire = sdk.socket.detached();
        poll.timer = setTimeout(() => closePoll(wire, sdk.room.id), dur * 1000);
      }

      sdk.socket.broadcast("state", { poll: serialize(sdk.room.id) });
      sdk.events.emit(BUS_EVENTS.STARTED, { question: q, options: opts.length });
      ack?.({ ok: true, poll: serialize(sdk.room.id) });
    },

    vote(sdk, { optionIdx } = {}, ack) {
      const p = polls.get(sdk.room.id);
      const idx = Number(optionIdx);
      if (!p || p.closed) return ack?.({ error: "No open poll" });
      if (!Number.isInteger(idx) || idx < 0 || idx >= p.options.length) return ack?.({ error: "Bad option" });

      // Voting again moves your vote; tapping the same option retracts it.
      const prev = p.votes.get(sdk.user.id);
      if (prev && prev.idx === idx) p.votes.delete(sdk.user.id);
      else p.votes.set(sdk.user.id, { idx, name: sdk.user.name });

      sdk.socket.broadcast("state", { poll: serialize(sdk.room.id) });
      ack?.({ ok: true });
    },

    close(sdk, _payload, ack) {
      const p = polls.get(sdk.room.id);
      if (!p || p.closed) return ack?.({ error: "No open poll" });
      // The creator closes it — or the owner, who can always end something
      // disruptive in their own room. The old handler allowed only the creator,
      // which left a room stuck if they disconnected.
      const isCreator = String(p.createdBy.id) === String(sdk.user.id);
      if (!isCreator && !sdk.room.isOwner(sdk.user.id)) {
        return ack?.({ error: "Only the creator can close it" });
      }
      closePoll(sdk.socket.detached(), sdk.room.id);
      sdk.events.emit(BUS_EVENTS.ENDED, { totalVotes: p.votes.size });
      ack?.({ ok: true });
    },

    /** Explicit resync — for a client that reconnected and wants current state. */
    sync(sdk, _payload, ack) {
      ack?.({ ok: true, poll: serialize(sdk.room.id) });
    },
  },

  /**
   * Last participant left.
   *
   * THE POINT OF THIS PLUGIN: clearing the timer is not optional. A pending
   * auto-close holds a closure over `io` and the poll for up to ten minutes
   * after everyone has gone, and would then broadcast into an empty room. Same
   * shape as Kart's physics interval, which is the reference case for exactly
   * this — the host calls destroy(); the plugin only has to mean it.
   */
  destroy(roomId) {
    const p = polls.get(roomId);
    if (!p) return;
    clearTimeout(p.timer);
    polls.delete(roomId);
  },
};

export function __pollCount() {
  return polls.size;
}
