import { cellInfo, coord, COLOR_HEX, COLOR_SOFT, COLORS } from "@/games/ludoBoard.js";

const N = 15;
const cells = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells.push([r, c]);

// A slightly darker shade of a hex color, for gradients/borders.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function cellStyle(r, c) {
  const info = cellInfo(r, c);
  switch (info.type) {
    case "base":
      return { background: `linear-gradient(135deg, ${COLOR_SOFT[info.color]}, ${shade(COLOR_HEX[info.color], -30)})` };
    case "home":
      return { background: `linear-gradient(135deg, ${shade(COLOR_HEX[info.color], 25)}, ${COLOR_HEX[info.color]})` };
    case "start":
      return { background: `radial-gradient(circle, ${shade(COLOR_HEX[info.color], 40)}, ${COLOR_HEX[info.color]})` };
    case "center":
      return { background: "radial-gradient(circle, #334155, #0f172a)" };
    case "track":
      return { background: "linear-gradient(180deg, #ffffff, #e9eef5)" };
    default:
      return { background: "transparent" };
  }
}

export default function LudoBoard({ state, myColor, isMyTurn, onMove }) {
  if (!state) return null;
  const seated = COLORS.filter((c) => state.seats?.[c]);
  const movable = new Set(isMyTurn ? state.movable || [] : []);

  return (
    <div
      className="relative w-full max-w-[min(92vw,560px)] mx-auto aspect-square rounded-2xl overflow-hidden select-none shadow-2xl"
      style={{ padding: 6, background: "linear-gradient(135deg, #1e293b, #0f172a)" }}
    >
      <div className="relative w-full h-full rounded-xl overflow-hidden ring-1 ring-white/10">
        {/* board cells */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${N},1fr)`, gridTemplateRows: `repeat(${N},1fr)` }}>
          {cells.map(([r, c]) => {
            const info = cellInfo(r, c);
            return (
              <div key={`${r},${c}`} style={cellStyle(r, c)} className="border border-black/5 flex items-center justify-center">
                {info.type === "track" && info.safe && <span className="text-[10px] text-amber-500 drop-shadow">★</span>}
                {info.type === "start" && <span className="text-[10px] text-white/90">➤</span>}
                {r === 7 && c === 7 && <span className="text-lg drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]">🏆</span>}
              </div>
            );
          })}
        </div>

        {/* tokens */}
        {seated.map((color) =>
          (state.tokens[color] || []).map((step, i) => {
            const [r, c] = coord(color, step, i);
            const clickable = color === myColor && movable.has(i);
            const dx = (i % 2) * 6 - 3;
            const dy = Math.floor(i / 2) * 6 - 3;
            return (
              <button
                key={`${color}-${i}`}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onMove(i)}
                title={`${color} token ${i + 1}`}
                style={{
                  left: `calc(${((c + 0.5) / N) * 100}% + ${dx}px)`,
                  top: `calc(${((r + 0.5) / N) * 100}% + ${dy}px)`,
                  background: `radial-gradient(circle at 32% 28%, ${shade(COLOR_HEX[color], 70)}, ${COLOR_HEX[color]} 60%, ${shade(COLOR_HEX[color], -40)})`,
                  transform: "translate(-50%,-50%)",
                  transition: "left 0.28s ease, top 0.28s ease, box-shadow 0.15s",
                  boxShadow: clickable
                    ? `0 0 0 2px #fff, 0 0 10px 3px ${COLOR_HEX[color]}, 0 2px 4px rgba(0,0,0,0.5)`
                    : "0 2px 4px rgba(0,0,0,0.55), inset 0 1px 2px rgba(255,255,255,0.4)",
                }}
                className={`absolute w-[4.8%] h-[4.8%] min-w-[15px] min-h-[15px] rounded-full border border-white/70
                  ${clickable ? "cursor-pointer animate-bounce z-20 hover:scale-110" : "z-10 cursor-default"}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
