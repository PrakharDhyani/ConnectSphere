/**
 * Sticky Notes — server module.
 *
 * Compare this file with sockets/whiteboard.handlers.js (127 lines) to see what
 * the plugin system is worth: there is no canAccessRoom call, no socket.rooms
 * membership check, no allow() rate limiting, no socket.io room names, no
 * debounce timer, no "was that the last participant?" detection. The host and
 * the SDK do all of it. What is left is only the part that is about notes.
 *
 * STATE LIVES IN sdk.storage, NOT A MODULE-LEVEL Map.
 * The whiteboard keeps a `scenes` Map because it predates the storage SDK and
 * the migration was deliberately behaviour-preserving. A new plugin has no such
 * excuse: storage already does the memory layer, the debounced write-behind and
 * the release-on-empty, and routing through it is what makes the eventual swap
 * to Redis a change to storage.js rather than to every plugin.
 *
 * THE SERVER IS THE AUTHORITY ON EVERY FIELD IT CARES ABOUT.
 * Ids, authorship and timestamps are assigned here, never taken from the
 * client. A client-supplied author id would let anyone write a note as someone
 * else; a client-supplied id would let one client overwrite another's note.
 * The client sends only what it is allowed to decide: text, colour, position.
 */
import { randomUUID } from "crypto";
import { BUS_EVENTS } from "../eventBus.js";

const MAX_TEXT = 280;
const DEFAULT_MAX_NOTES = 100;

// The palette the client offers. Validated server-side so a crafted payload
// cannot inject arbitrary CSS into everyone else's board.
export const COLORS = Object.freeze(["yellow", "pink", "blue", "green", "purple", "orange"]);

const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Positions are stored as FRACTIONS of the board (0..1), not pixels.
 *
 * Two people on a phone and a 4K monitor must see the same layout; pixel
 * coordinates would put a note off-screen for whoever has the smaller board.
 * Clamping also means a hostile client cannot park a note at x = 10^9 where
 * nobody can reach it to delete it.
 */
const sanitizePos = (pos) => ({ x: clamp01(pos?.x), y: clamp01(pos?.y) });

function sanitizeText(raw) {
  if (typeof raw !== "string") return "";
  return raw.slice(0, MAX_TEXT);
}

const sanitizeColor = (c) => (COLORS.includes(c) ? c : COLORS[0]);

/** Read the note list, defaulting to empty. Always an array. */
async function readNotes(sdk) {
  const data = await sdk.storage.get({ notes: [] });
  return Array.isArray(data?.notes) ? data.notes : [];
}

const writeNotes = (sdk, notes) => sdk.storage.set({ notes });

/**
 * May this user delete this note? Mirrors the `allowDelete` config option.
 * Centralised because "who may destroy something" is the one rule here worth
 * having exactly one copy of.
 */
function canDelete(sdk, note) {
  const mode = sdk.meta.config.allowDelete || "author";
  if (mode === "anyone") return true;
  if (mode === "owner") return sdk.room.isOwner(sdk.user.id);
  return String(note.authorId) === String(sdk.user.id);
}

export default {
  /** Late joiners get the whole board; the ack becomes the client's state. */
  async onJoin(sdk) {
    return { notes: await readNotes(sdk), you: sdk.user.id };
  },

  rates: {
    // Dragging emits continuously, so it gets the generous budget; creating and
    // deleting are deliberate acts and get a tight one.
    move: { max: 40, windowMs: 1000 },
    edit: { max: 20, windowMs: 1000 },
    create: { max: 10, windowMs: 5000 },
    remove: { max: 20, windowMs: 5000 },
  },

  events: {
    async create(sdk, { text, color, pos } = {}, ack) {
      const notes = await readNotes(sdk);
      const cap = sdk.meta.config.maxNotes || DEFAULT_MAX_NOTES;
      // Refuse rather than silently drop: a client that thinks it created a
      // note and did not would show a note that vanishes on the next reload.
      if (notes.length >= cap) return ack?.({ error: `Board is full (${cap} notes)` });

      const note = {
        id: randomUUID(),
        text: sanitizeText(text),
        color: sanitizeColor(color),
        pos: sanitizePos(pos),
        authorId: sdk.user.id,
        authorName: sdk.user.name,
        createdAt: Date.now(),
      };
      await writeNotes(sdk, [...notes, note]);

      // Broadcast, not toOthers: the author's own note is confirmed by the same
      // event everyone else gets, so there is one code path for "a note
      // appeared" instead of an optimistic copy that can drift from the server's.
      sdk.socket.broadcast("created", { note });
      ack?.({ ok: true, note });
    },

    async edit(sdk, { id, text, color } = {}) {
      const notes = await readNotes(sdk);
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      // Editing is author-only regardless of allowDelete: rewriting someone
      // else's words under their name is a different act from removing a note.
      if (String(note.authorId) !== String(sdk.user.id)) return;

      if (text !== undefined) note.text = sanitizeText(text);
      if (color !== undefined) note.color = sanitizeColor(color);
      await writeNotes(sdk, notes);
      sdk.socket.broadcast("edited", { id, text: note.text, color: note.color });
    },

    /**
     * Dragging. Anyone may move any note — rearranging a shared wall is the
     * collaborative act this plugin exists for, and unlike editing it destroys
     * nothing.
     */
    async move(sdk, { id, pos } = {}) {
      const notes = await readNotes(sdk);
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      note.pos = sanitizePos(pos);
      await writeNotes(sdk, notes);
      // toOthers: the dragger is already rendering the position under their own
      // cursor, and echoing it back would fight their pointer mid-drag.
      sdk.socket.toOthers("moved", { id, pos: note.pos });
    },

    async remove(sdk, { id } = {}, ack) {
      const notes = await readNotes(sdk);
      const note = notes.find((n) => n.id === id);
      if (!note) return ack?.({ ok: true }); // already gone: not an error
      if (!canDelete(sdk, note)) return ack?.({ error: "You can't delete that note" });

      await writeNotes(sdk, notes.filter((n) => n.id !== id));
      sdk.socket.broadcast("removed", { id });
      ack?.({ ok: true });
    },

    /** Explicit save — flush now and announce it on the bus. */
    async save(sdk, _payload, ack) {
      await sdk.storage.flush();
      const notes = await readNotes(sdk);
      sdk.events.emit(BUS_EVENTS.SAVED, { noteCount: notes.length });
      ack?.({ ok: true, noteCount: notes.length });
    },
  },

  /**
   * Last participant left. storage.release() flushes to Mongo and drops the
   * in-memory cell, so the board survives while the process does not grow a
   * cell per room it has ever seen.
   */
  async destroy(roomId) {
    const { createStorage } = await import("../storage.js");
    await createStorage("sticky-notes", roomId).release();
  },
};
