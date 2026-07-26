import { cellInfo, coord, COLOR_HEX, COLOR_SOFT, COLORS } from "@/games/ludoBoard.js";

const N = 15;
const cells = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells.push([r, c]);

function cellStyle(r, c) {
  const info = cellInfo(r, c);
  switch (info.type) {
    case "base":
      return { background: COLOR_SOFT[info.color] };
    case "home":
      return { background: COLOR_HEX[info.color] };
    case "start":
      return { background: COLOR_HEX[info.color] };
    case "center":
      return { background: "#1f2937" };
    case "track":
      return { background: "#f8fafc" };
    default:
      return { background: "transparent" };
  }
}

export default function LudoBoard({ state, myColor, isMyTurn, onMove }) {
  if (!state) return null;
  const seated = COLORS.filter((c) => state.seats?.[c]);
  const movable = new Set(isMyTurn ? state.movable || [] : []);

  return (
    <div className="relative w-full max-w-[min(92vw,560px)] mx-auto aspect-square rounded-xl overflow-hidden border border-gray-700 select-none">
      {/* board cells */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${N},1fr)`, gridTemplateRows: `repeat(${N},1fr)` }}>
        {cells.map(([r, c]) => {
          const info = cellInfo(r, c);
          return (
            <div key={`${r},${c}`} style={cellStyle(r, c)} className="border border-black/10 flex items-center justify-center">
              {info.type === "track" && info.safe && <span className="text-[8px] text-gray-400">★</span>}
              {r === 7 && c === 7 && <span className="text-sm">🏁</span>}
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
                background: COLOR_HEX[color],
                transform: "translate(-50%,-50%)",
              }}
              className={`absolute w-[4.5%] h-[4.5%] min-w-[14px] min-h-[14px] rounded-full border-2 border-white shadow
                ${clickable ? "ring-2 ring-white cursor-pointer animate-pulse z-20" : "z-10 cursor-default"}`}
            />
          );
        })
      )}
    </div>
  );
}
