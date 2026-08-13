/**
 * In-room polls — "what do we do next?"
 *
 * One poll per room at a time, held in memory (like game state — a poll that
 * outlives the hangout has no value, so nothing is persisted). Anyone in the
 * room can open one when none is active; voters can change their vote while
 * it's open; only the creator (or the poll timer) closes it. Results stay on
 * screen until someone starts the next poll.
 *
 * Events (client → server, ack = { ok } | { ok:false, error }):
 *   poll:create ({roomId, question, options[], durationSec?})
 *   poll:vote   ({roomId, optionIdx})
 *   poll:close  ({roomId})
 *   poll:sync   (roomId)  → ack({ ok, poll })   for late joiners / reconnects
 *
 * Events (server → client):
 *   poll:state  ({ roomId, poll })   broadcast to the whole room on any change
 */
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

const polls = new Map(); // roomId → { id, question, options:[{text}], votes:Map<userId,{idx,name}>, createdBy, closed, endsAt, timer }

const MAX_QUESTION = 200;
const MAX_OPTION = 80;
const MAX_OPTIONS = 6;

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

function broadcast(io, roomId) {
  io.to(roomKey(roomId)).emit("poll:state", { roomId, poll: serialize(roomId) });
}

function closePoll(io, roomId) {
  const p = polls.get(roomId);
  if (!p || p.closed) return;
  p.closed = true;
  p.endsAt = null;
  clearTimeout(p.timer);
  broadcast(io, roomId);
}

export function registerPollHandlers(io, socket) {
  socket.on("poll:create", async ({ roomId, question, options, durationSec } = {}, ack) => {
    try {
      question = (question || "").trim();
      const opts = (Array.isArray(options) ? options : [])
        .map((o) => String(o || "").trim())
        .filter(Boolean);

      if (!roomId || !socket.rooms.has(roomKey(roomId))) return ack?.({ ok: false, error: "Not in room" });
      if (!question || question.length > MAX_QUESTION) return ack?.({ ok: false, error: "Question is required (max 200 chars)" });
      if (opts.length < 2 || opts.length > MAX_OPTIONS) return ack?.({ ok: false, error: "Give 2–6 options" });
      if (opts.some((o) => o.length > MAX_OPTION)) return ack?.({ ok: false, error: "Options max 80 chars" });
      if (!allow(socket, "poll", 3, 60_000)) return ack?.({ ok: false, error: "Slow down a moment" });
      if (!(await canAccessRoom(socket.user, roomId))) return ack?.({ ok: false, error: "Not a member" });

      const existing = polls.get(roomId);
      if (existing && !existing.closed) return ack?.({ ok: false, error: "A poll is already running" });
      if (existing) clearTimeout(existing.timer);

      // 0 = no timer; otherwise clamp to 15s–10min so a typo can't pin a poll open.
      const dur = Math.min(600, Math.max(0, Number(durationSec) || 0));
      const poll = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question,
        options: opts.map((text) => ({ text })),
        votes: new Map(),
        createdBy: { id: socket.user.id, name: socket.user.name },
        closed: false,
        endsAt: dur >= 15 ? Date.now() + dur * 1000 : null,
        timer: null,
      };
      if (poll.endsAt) poll.timer = setTimeout(() => closePoll(io, roomId), dur * 1000);
      polls.set(roomId, poll);

      broadcast(io, roomId);
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, error: "Could not create poll" });
    }
  });

  socket.on("poll:vote", ({ roomId, optionIdx } = {}, ack) => {
    const p = polls.get(roomId);
    const idx = Number(optionIdx);
    if (!roomId || !socket.rooms.has(roomKey(roomId))) return ack?.({ ok: false, error: "Not in room" });
    if (!p || p.closed) return ack?.({ ok: false, error: "No open poll" });
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.options.length) return ack?.({ ok: false, error: "Bad option" });
    if (!allow(socket, "pollVote", 10, 10_000)) return ack?.({ ok: false, error: "Slow down" });

    // Voting again just moves your vote — tapping the same option retracts it.
    const prev = p.votes.get(socket.user.id);
    if (prev && prev.idx === idx) p.votes.delete(socket.user.id);
    else p.votes.set(socket.user.id, { idx, name: socket.user.name });

    broadcast(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("poll:close", ({ roomId } = {}, ack) => {
    const p = polls.get(roomId);
    if (!p || p.closed) return ack?.({ ok: false, error: "No open poll" });
    if (p.createdBy.id !== socket.user.id) return ack?.({ ok: false, error: "Only the creator can close it" });
    closePoll(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("poll:sync", (roomId, ack) => {
    if (!roomId || !socket.rooms.has(roomKey(roomId))) return ack?.({ ok: false });
    ack?.({ ok: true, poll: serialize(roomId) });
  });
}
