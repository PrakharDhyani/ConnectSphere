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
import { connectSocket, getSocket } from "@/lib/socket.js";

const CURSOR_COLORS = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#ae3ec9", "#0c8599", "#e8590c"];
const colorFor = (id) => CURSOR_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % CURSOR_COLORS.length];

export default function WhiteboardPanel({ roomId }) {
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

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();

    const onUpdate = ({ elements }) => applyRemote(elements);
    const onPointer = ({ socketId, name, pointer }) => {
      if (!pointer) return;
      collaborators.current.set(socketId, {
        username: name,
        pointer,
        color: { background: colorFor(socketId), stroke: colorFor(socketId) },
      });
      api.current?.updateScene({ collaborators: new Map(collaborators.current) });
    };
    const onPointerLeft = ({ socketId }) => {
      collaborators.current.delete(socketId);
      api.current?.updateScene({ collaborators: new Map(collaborators.current) });
    };

    socket.on("whiteboard:update", onUpdate);
    socket.on("whiteboard:pointer", onPointer);
    socket.on("whiteboard:pointerLeft", onPointerLeft);

    const join = () => {
      socket.emit("whiteboard:join", roomId, (res) => {
        if (res?.elements?.length) applyRemote(res.elements);
      });
      socket.emit("room:announce", { roomId, activity: "board" }); // notify the room
    };
    if (socket.connected) join();
    else socket.once("connect", join);

    const collab = collaborators.current;
    return () => {
      socket.emit("whiteboard:leave", roomId);
      socket.off("whiteboard:update", onUpdate);
      socket.off("whiteboard:pointer", onPointer);
      socket.off("whiteboard:pointerLeft", onPointerLeft);
      collab.clear();
    };
  }, [roomId, applyRemote]);

  const handleChange = useCallback(() => {
    if (suppress.current || !api.current) return;
    const now = Date.now();
    if (now - lastSceneSend.current < 50) return; // ~20 updates/sec max
    lastSceneSend.current = now;
    // Include deleted elements so deletions propagate to peers.
    const elements = api.current.getSceneElementsIncludingDeleted?.() || [];
    getSocket().emit("whiteboard:update", { roomId, elements });
  }, [roomId]);

  const handlePointer = useCallback(
    (payload) => {
      const now = Date.now();
      if (now - lastPointerSend.current < 60) return;
      lastPointerSend.current = now;
      getSocket().emit("whiteboard:pointer", { roomId, pointer: payload?.pointer });
    },
    [roomId]
  );

  return (
    <div className="h-[75vh] rounded-2xl overflow-hidden border border-gray-800">
      <Excalidraw
        excalidrawAPI={(instance) => (api.current = instance)}
        onChange={handleChange}
        onPointerUpdate={handlePointer}
        theme="dark"
        name="ConnectSphere whiteboard"
      />
    </div>
  );
}
