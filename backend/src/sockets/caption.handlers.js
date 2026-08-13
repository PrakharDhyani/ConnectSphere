/**
 * Live captions relay.
 *
 * The SFU (mediasoup) forwards encrypted RTP — the server never decodes audio,
 * so speech recognition happens in each speaker's OWN browser (Web Speech API)
 * and the resulting text is relayed here to everyone else in the room. Purely
 * transient: nothing is stored, exactly like `typing`.
 *
 * Events (client → server):
 *   caption:say ({roomId, text, interim, lang})
 * Events (server → client):
 *   caption:new ({roomId, userId, name, text, interim, lang, at})
 *
 * `interim` lines are the recognizer's live guess (they get overwritten by the
 * final line), so they're relayed at a higher rate but never logged.
 */
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";

const MAX_TEXT = 500;

export function registerCaptionHandlers(io, socket) {
  socket.on("caption:say", ({ roomId, text, interim, lang } = {}) => {
    text = String(text || "").slice(0, MAX_TEXT).trim();
    if (!roomId || !text || !socket.rooms.has(roomKey(roomId))) return;
    // Interim results stream fast (several per second while talking); finals
    // arrive at sentence pace. One shared generous bucket keeps both honest.
    if (!allow(socket, "caption", 20, 5_000)) return;
    socket.to(roomKey(roomId)).emit("caption:new", {
      roomId,
      userId: socket.user.id,
      name: socket.user.name,
      text,
      interim: Boolean(interim),
      lang: String(lang || "").slice(0, 12) || null,
      at: Date.now(),
    });
  });
}
