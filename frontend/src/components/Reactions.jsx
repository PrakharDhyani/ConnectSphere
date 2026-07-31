/**
 * Shared sticker-reaction system for every game. One hook + two components:
 *
 *   const rx = useReactions("uno", roomId);
 *   <ReactionBar send={rx.send} />           // the clickable sticker tray
 *   <ReactionOverlay floats={rx.floats} />   // big animated stickers floating up
 *
 * The server echoes `${prefix}:react` to the whole room (sender included), so
 * everyone — spectators too — sees the same animation at the same time.
 */
import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket.js";
import { STICKERS } from "@/components/stickers/Stickers.jsx";
import { sfx } from "@/lib/sfx.js";

export function useReactions(prefix, roomId) {
  const [floats, setFloats] = useState([]);
  const heardRef = useRef(new Set());

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();
    const onReact = (r) => {
      if (!STICKERS[r.kind]) return;
      setFloats((f) => [...f.slice(-9), { ...r, left: 8 + Math.random() * 74 }]);
      if (!heardRef.current.has(r.id)) {
        heardRef.current.add(r.id);
        sfx.play(STICKERS[r.kind].sound);
        if (heardRef.current.size > 80) {
          heardRef.current = new Set([...heardRef.current].slice(-40));
        }
      }
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== r.id)), 3400);
    };
    socket.on(`${prefix}:react`, onReact);
    return () => socket.off(`${prefix}:react`, onReact);
  }, [prefix, roomId]);

  const send = (kind) => getSocket().emit(`${prefix}:react`, { roomId, kind });
  return { floats, send };
}

/** The sticker tray — each button pops on press and fires the reaction. */
export function ReactionBar({ send, className = "" }) {
  const [pressed, setPressed] = useState(null);
  const fire = (kind) => {
    setPressed(kind);
    setTimeout(() => setPressed(null), 250);
    send(kind);
  };
  return (
    <div className={`flex justify-center gap-1 bg-gray-900/80 border border-gray-800 rounded-xl px-2 py-1.5 ${className}`}>
      {Object.entries(STICKERS).map(([kind, s]) => (
        <button
          key={kind}
          type="button"
          onClick={() => fire(kind)}
          title={s.label}
          className="rounded-lg p-0.5 transition-transform duration-150 hover:scale-125 hover:-translate-y-1"
          style={pressed === kind ? { transform: "scale(0.8)" } : undefined}
        >
          <s.Comp size={34} />
        </button>
      ))}
    </div>
  );
}

/** Full-size stickers floating up over the game area (mount in a relative parent). */
export function ReactionOverlay({ floats }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
      <style>{`
        @keyframes rx-rise {
          0% { transform: translateY(0) scale(0.5); opacity: 0 }
          10% { opacity: 1; transform: translateY(-14px) scale(1) }
          80% { opacity: 1 }
          100% { transform: translateY(-300px) scale(1.15); opacity: 0 }
        }
      `}</style>
      {floats.map((f) => {
        const S = STICKERS[f.kind];
        if (!S) return null;
        return (
          <div
            key={f.id}
            className="absolute bottom-[4%]"
            style={{ left: `${f.left}%`, animation: "rx-rise 3.2s cubic-bezier(0.22,1,0.36,1) forwards" }}
          >
            <S.Comp size={92} />
            <p className="text-center text-[11px] font-semibold text-white/85 drop-shadow -mt-1">{f.name}</p>
          </div>
        );
      })}
    </div>
  );
}
