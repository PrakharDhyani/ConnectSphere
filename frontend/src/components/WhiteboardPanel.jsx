/**
 * Collaborative whiteboard = the Excalidraw component + our Socket.io sync.
 *
 * Excalidraw gives us the entire drawing surface (infinite canvas, every tool,
 * arrows/binding, text, images, frames, styling, alignment, layers, undo/redo,
 * export, library, mobile/stylus, shortcuts…). We add the *group* layer:
 *  - broadcast local scene changes (throttled) to everyone viewing the board
 *  - merge remote changes by element `version` (last-write-wins per element),
 *    so concurrent edits converge without dropping local work
 *  - relay live cursors as Excalidraw "collaborators"
 *  - late joiners get the current scene from the server on join
 */
import { useCallback, useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { getSocket } from "@/lib/socket.js";
import { useActivitySdk } from "@/activities/useActivitySdk.js";
import { useAuthStore } from "@/stores/auth.store.js";

const CURSOR_COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#ae3ec9", "#0c8599", "#e8590c"];
const colorFor = (id) => CURSOR_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % CURSOR_COLORS.length];

export default function WhiteboardPanel({ roomId }) {
  const me = useAuthStore((s) => s.user);
  /**
   * The whiteboard's SERVER module has been a plugin since Phase 2; this panel
   * was the last piece still speaking raw `whiteboard:*` socket events, which
   * is why `ACTIVITY_PLUGINS=whiteboard` would previously have broken it. Both
   * halves now speak the same protocol.
   *
   * The join ack carries the current scene, so a late joiner is caught up by
   * the same access-controlled round trip that admits them — no separate fetch.
   */
  const { sdk, state: joined } = useActivitySdk("whiteboard", roomId, { user: me });
  const api = useRef(null);
  const suppress = useRef(false); // don't rebroadcast changes we applied from remote
  const collaborators = useRef(new Map());
  const lastSceneSend = useRef(0);
  const lastPointerSend = useRef(0);

  // Apply a remote element set, merged with ours by version (LWW per element),
  // so we never clobber local elements the sender didn't have.
  const applyRemote = useCallback((remoteElements) => {
    if (!api.current) return;
    const local = api.current.getSceneElementsIncludingDeleted?.() || [];
    const byId = new Map(local.map((el) => [el.id, el]));
    for (const rel of remoteElements) {
      const cur = byId.get(rel.id);
      if (!cur || (rel.version ?? 0) >= (cur.version ?? 0)) byId.set(rel.id, rel);
    }
    suppress.current = true;
    api.current.updateScene({ elements: [...byId.values()] });
    setTimeout(() => {
      suppress.current = false;
    }, 0);
  }, []);

  // The scene arrives with the join ack, not a separate request.
  useEffect(() => {
    if (joined?.elements?.length) applyRemote(joined.elements);
  }, [joined, applyRemote]);

  useEffect(() => {
    if (!sdk?.socket) return undefined;
    const offs = [
      sdk.socket.on("update", ({ elements }) => applyRemote(elements)),
      sdk.socket.on("pointer", ({ socketId, name, pointer }) => {
        if (!pointer) return;
        collaborators.current.set(socketId, {
          username: name,
          pointer,
          color: { background: colorFor(socketId), stroke: colorFor(socketId) },
        });
        api.current?.updateScene({ collaborators: new Map(collaborators.current) });
      }),
      sdk.socket.on("pointerLeft", ({ socketId }) => {
        collaborators.current.delete(socketId);
        api.current?.updateScene({ collaborators: new Map(collaborators.current) });
      }),
    ];
    // `room:announce` is CORE room traffic, not plugin traffic — it drives the
    // tap-to-join toast for people who are not looking at the board tab. The
    // legacy id "board" is kept: older clients and the room-view aliases map it
    // onto the whiteboard manifest.
    getSocket().emit("room:announce", { roomId, activity: "board" });

    const collab = collaborators.current;
    return () => {
      offs.forEach((off) => off());
      collab.clear();
    };
  }, [sdk, roomId, applyRemote]);

  const handleChange = useCallback(() => {
    if (suppress.current || !api.current || !sdk?.socket) return;
    const now = Date.now();
    if (now - lastSceneSend.current < 50) return; // ~20 updates/sec max
    lastSceneSend.current = now;
    // Include deleted elements so deletions propagate to peers.
    const elements = api.current.getSceneElementsIncludingDeleted?.() || [];
    sdk.socket.post("update", { elements });
  }, [sdk]);

  const handlePointer = useCallback(
    (payload) => {
      if (!sdk?.socket) return;
      const now = Date.now();
      if (now - lastPointerSend.current < 60) return;
      lastPointerSend.current = now;
      sdk.socket.post("pointer", { pointer: payload?.pointer });
    },
    [sdk]
  );

  return (
    <div className="h-[75vh] rounded-2xl overflow-hidden border border-gray-800">
      <Excalidraw
        excalidrawAPI={(instance) => (api.current = instance)}
        onChange={handleChange}
        onPointerUpdate={handlePointer}
        theme="dark"
        name="Groot whiteboard"
      />
    </div>
  );
}
