/**
 * The shared drawing surface for the game.
 *
 * Responsive by design: the canvas has a FIXED internal buffer (1000×600) but
 * is scaled to 100% width via CSS, and every stroke is sent in NORMALIZED
 * coordinates (0..1), so it looks identical on a phone and a laptop. Pointer
 * events cover mouse, touch, and stylus; `touch-none` stops the page scrolling
 * while you draw.
 *
 * Only the drawer's pointer draws + broadcasts; everyone renders incoming
 * `game:draw` segments and clears on `game:clear`.
 */
import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket.js";
import Button from "@/components/ui/Button.jsx";

const W = 1000;
const H = 600;
const PALETTE = ["#111827", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#ae3ec9", "#ffffff"];

export default function GameCanvas({ roomId, isDrawer }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [color, setColor] = useState("#111827");
  const [size, setSize] = useState(5);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;

    const seg = (s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(s.x0 * W, s.y0 * H);
      ctx.lineTo(s.x1 * W, s.y1 * H);
      ctx.stroke();
    };
    const socket = getSocket();
    const onDraw = ({ stroke }) => seg(stroke);
    const onClear = () => ctx.clearRect(0, 0, W, H);
    socket.on("game:draw", onDraw);
    socket.on("game:clear", onClear);
    return () => {
      socket.off("game:draw", onDraw);
      socket.off("game:clear", onClear);
    };
  }, []);

  const drawSeg = (s) => {
    const ctx = ctxRef.current;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(s.x0 * W, s.y0 * H);
    ctx.lineTo(s.x1 * W, s.y1 * H);
    ctx.stroke();
  };

  const norm = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e) => {
    if (!isDrawer) return;
    drawing.current = true;
    last.current = norm(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!isDrawer || !drawing.current) return;
    const p = norm(e);
    const stroke = { x0: last.current.x, y0: last.current.y, x1: p.x, y1: p.y, color, size };
    drawSeg(stroke);
    getSocket().emit("game:draw", { roomId, stroke });
    last.current = p;
  };
  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    ctxRef.current.clearRect(0, 0, W, H);
    getSocket().emit("game:clear", { roomId });
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        style={{ aspectRatio: `${W} / ${H}` }}
        className={`w-full bg-white rounded-xl touch-none ${isDrawer ? "cursor-crosshair" : "cursor-default"}`}
      />
      {isDrawer && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={`w-7 h-7 rounded-full border ${color === c ? "ring-2 ring-brand-500" : "border-gray-600"}`}
              title={c === "#ffffff" ? "Eraser" : c}
            />
          ))}
          <input
            type="range"
            min="2"
            max="24"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="accent-brand-500"
          />
          <Button variant="secondary" onClick={clear}>Clear</Button>
        </div>
      )}
    </div>
  );
}
