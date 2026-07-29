import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useKart } from "@/hooks/useKart.js";
import { MAP_LIST, MODES } from "@/games/kartMaps.js";

// Lazy so Three.js (~600 kB) is only fetched when someone actually plays karts.
const KartArena3D = lazy(() => import("@/components/KartArena3D.jsx"));

const COLOR_HEX = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", orange: "#f97316", purple: "#a855f7",
};
const TEAM_HEX = { A: "#3b82f6", B: "#ef4444" };
const BOT_LEVELS = [
  { id: "easy", name: "Easy" },
  { id: "medium", name: "Medium" },
  { id: "hard", name: "Hard" },
];
const mapName = (id) => MAP_LIST.find((m) => m.id === id)?.name || "Speedway";
const modeName = (id) => MODES.find((m) => m.id === id)?.name || "Free for all";

// Press-and-hold touch button; releases on leave/cancel so no key gets stuck.
function HoldButton({ onHold, className, children, label }) {
  const press = (down) => (e) => { e.preventDefault(); onHold(down); };
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={press(true)}
      onPointerUp={press(false)}
      onPointerLeave={press(false)}
      onPointerCancel={press(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`select-none touch-none flex items-center justify-center text-white font-bold backdrop-blur active:scale-95 transition-transform ${className}`}
    >
      {children}
    </button>
  );
}

export default function KartPanel({ roomId, onExit }) {
  const { me, status, view, snapRef, killFeedRef, boomsRef, joined, isHost, error, join, leave, start, reset, sendInput, setConfig, addBot, removeBot } =
    useKart(roomId);
  const [botDiff, setBotDiff] = useState("medium");

  // ── Shared input pipeline (keyboard + touch) ──
  const keysRef = useRef(new Set());
  const lastSentRef = useRef("");
  const flush = useCallback(() => {
    const k = keysRef.current;
    const throttle = (k.has("up") ? 1 : 0) - (k.has("down") ? 1 : 0);
    const steer = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
    const shoot = k.has("shoot");
    const sig = `${throttle}|${steer}|${shoot}`;
    if (sig !== lastSentRef.current) { lastSentRef.current = sig; sendInput({ throttle, steer, shoot }); }
  }, [sendInput]);
  const pressKey = useCallback((key, down) => {
    if (down) keysRef.current.add(key); else keysRef.current.delete(key);
    flush();
  }, [flush]);

  useEffect(() => {
    if (status !== "playing") return;
    const keys = keysRef.current;
    const map = (e) => {
      switch (e.code) {
        case "KeyW": case "ArrowUp": return "up";
        case "KeyS": case "ArrowDown": return "down";
        case "KeyA": case "ArrowLeft": return "left";
        case "KeyD": case "ArrowRight": return "right";
        case "Space": return "shoot";
        default: return null;
      }
    };
    const onDown = (e) => { const key = map(e); if (!key) return; e.preventDefault(); pressKey(key, true); };
    const onUp = (e) => { const key = map(e); if (!key) return; e.preventDefault(); pressKey(key, false); };
    const onBlur = () => { keys.clear(); flush(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      keys.clear();
      lastSentRef.current = "";
    };
  }, [status, pressKey, flush]);

  // Show on-screen controls on touch devices / small screens.
  const [showTouch, setShowTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 820px)");
    const update = () => setShowTouch(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const doLeaveGame = () => { setConfirmLeave(false); leave(); onExit?.(); };

  const LeaveModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-xs w-full text-center">
        <p className="text-lg font-semibold">Leave the match?</p>
        <p className="text-sm text-gray-400 mt-1">You&apos;ll drop out of the arena and return to the games menu.</p>
        <div className="flex gap-2 justify-center mt-5">
          <button onClick={() => setConfirmLeave(false)} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">Cancel</button>
          <button onClick={doLeaveGame} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 font-medium">Leave</button>
        </div>
      </div>
    </div>
  );

  // ── Lobby ──
  if (status === "lobby") {
    const players = view?.players || [];
    const selMap = view?.mapId || "speedway";
    const selMode = view?.mode || "ffa";
    return (
      <div className="max-w-md mx-auto text-center py-6">
        <div className="text-4xl">🏎️</div>
        <h2 className="text-lg font-semibold mt-2">Smash Karts 3D</h2>
        <p className="text-gray-500 text-sm mb-4">Drive, shoot, grab powerups — most kills in 3 minutes wins.</p>
        <p className="text-xs text-gray-600 mb-4">🛡️ shield blocks bullets, bombs, mines <i>and</i> freezes.</p>

        {/* Map + mode selection */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 space-y-3">
          <div>
            <div className="text-xs uppercase text-gray-500 mb-1.5">Map</div>
            <div className="flex gap-2 justify-center">
              {MAP_LIST.map((m) => (
                <button
                  key={m.id}
                  disabled={!isHost}
                  onClick={() => setConfig({ mapId: m.id })}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${selMap === m.id ? "bg-brand-600 border-brand-500" : "bg-gray-800 border-gray-700"} ${isHost ? "hover:border-brand-500" : "opacity-70 cursor-default"}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500 mb-1.5">Mode</div>
            <div className="flex gap-2 justify-center">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  disabled={!isHost}
                  onClick={() => setConfig({ mode: m.id })}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${selMode === m.id ? "bg-brand-600 border-brand-500" : "bg-gray-800 border-gray-700"} ${isHost ? "hover:border-brand-500" : "opacity-70 cursor-default"}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          {!isHost && <p className="text-xs text-gray-600">Only the host can change the map / mode.</p>}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 text-left">
          <div className="text-xs uppercase text-gray-500 mb-2">In the arena ({players.length}/6)</div>
          {players.length === 0 && <div className="text-sm text-gray-600">No karts have joined yet.</div>}
          <ul className="space-y-1">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full" style={{ background: COLOR_HEX[p.color] }} />
                <span>{p.name}{p.id === me?.id && " (you)"}</span>
                {p.isBot && <span className="text-xs px-1.5 rounded bg-gray-800 text-gray-400">bot</span>}
                {p.id === view?.hostId && <span className="text-xs text-gray-500">host</span>}
                {isHost && p.isBot && (
                  <button onClick={() => removeBot(p.id)} className="ml-auto text-xs text-gray-500 hover:text-red-400" aria-label={`Remove ${p.name}`}>
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {isHost && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              <div className="text-xs uppercase text-gray-500 mb-1.5">Add a bot</div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {BOT_LEVELS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setBotDiff(d.id)}
                      className={`px-2 py-1 rounded-md text-xs border ${botDiff === d.id ? "bg-brand-600 border-brand-500" : "bg-gray-800 border-gray-700 hover:border-brand-500"}`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => addBot(botDiff)}
                  disabled={players.length >= 6}
                  className="ml-auto px-3 py-1 rounded-md text-sm bg-gray-800 border border-gray-700 hover:border-brand-500 disabled:opacity-40"
                >
                  + Bot
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-center">
          {!joined ? (
            <button onClick={() => join()} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 font-medium">Join arena</button>
          ) : (
            <button onClick={() => leave()} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">Leave seat</button>
          )}
          {isHost && (
            <button onClick={() => start()} disabled={players.length < 1} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 font-medium disabled:opacity-40">
              Start match
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        {!isHost && joined && <p className="text-xs text-gray-500 mt-3">Waiting for the host to start…</p>}
        <p className="text-xs text-gray-600 mt-4"><b>WASD / arrows</b> drive, <b>Space</b> shoot — or the on-screen pad on touch.</p>
      </div>
    );
  }

  // ── Ended: final scoreboard ──
  if (status === "ended") {
    const players = view?.players || [];
    const tdm = view?.mode === "tdm";
    const winnerP = players.find((p) => p.id === view?.winnerId);
    return (
      <div className="max-w-md mx-auto text-center py-6">
        <div className="text-4xl">🏁</div>
        <h2 className="text-lg font-semibold mt-2">Match over</h2>
        {tdm ? (
          <p className="font-medium mb-4">
            {view?.winnerTeam === "tie" ? (
              <span className="text-gray-300">It&apos;s a tie! 🤝</span>
            ) : (
              <span style={{ color: TEAM_HEX[view?.winnerTeam] }}>Team {view?.winnerTeam} wins! 🏆</span>
            )}
            {view?.teamScores && (
              <span className="block text-sm mt-1 text-gray-400">
                <span style={{ color: TEAM_HEX.A }}>{view.teamScores.A}</span> vs <span style={{ color: TEAM_HEX.B }}>{view.teamScores.B}</span>
              </span>
            )}
          </p>
        ) : (
          winnerP && (
            <p className="text-brand-400 font-medium mb-4">🏆 {winnerP.name}{winnerP.id === me?.id && " (you)"} wins with {winnerP.kills} kills!</p>
          )
        )}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 text-left">
          {players.map((p, i) => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1">
              <span className="flex items-center gap-2">
                <span className="text-gray-500 w-4">{i + 1}.</span>
                <span className="w-3 h-3 rounded-full" style={{ background: tdm && p.team ? TEAM_HEX[p.team] : COLOR_HEX[p.color] }} />
                {p.name}{p.id === me?.id && " (you)"}
              </span>
              <span className="text-gray-400">{p.kills} K / {p.deaths} D</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-center">
          {isHost && <button onClick={() => reset()} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 font-medium">Back to lobby</button>}
          <button onClick={() => onExit?.()} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">Exit</button>
        </div>
      </div>
    );
  }

  // ── Playing ──
  const padBtn = "w-14 h-14 rounded-full bg-white/15 border border-white/25 text-2xl active:bg-brand-600/70";
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setConfirmLeave(true)} className="text-sm text-gray-400 hover:text-red-400">← Leave game</button>
        <span className="text-xs text-gray-500">{mapName(view?.mapId)} · {modeName(view?.mode)}</span>
      </div>

      <div className="relative mx-auto max-w-4xl">
        <Suspense fallback={<div className="text-center py-16 text-gray-500">Loading arena…</div>}>
          <KartArena3D snapRef={snapRef} killFeedRef={killFeedRef} boomsRef={boomsRef} myId={me?.id} />
        </Suspense>

        {showTouch && (
          <>
            <div className="absolute bottom-4 left-3 flex gap-3">
              <HoldButton label="Steer left" onHold={(d) => pressKey("left", d)} className={padBtn}>◀</HoldButton>
              <HoldButton label="Steer right" onHold={(d) => pressKey("right", d)} className={padBtn}>▶</HoldButton>
            </div>
            <div className="absolute bottom-4 right-3 flex items-end gap-3">
              <div className="flex flex-col gap-2">
                <HoldButton label="Accelerate" onHold={(d) => pressKey("up", d)} className={padBtn}>▲</HoldButton>
                <HoldButton label="Reverse" onHold={(d) => pressKey("down", d)} className={padBtn}>▼</HoldButton>
              </div>
              <HoldButton label="Fire" onHold={(d) => pressKey("shoot", d)} className="w-20 h-20 rounded-full bg-red-500/70 border-2 border-red-300/50 text-3xl active:bg-red-500">🔥</HoldButton>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-xs text-gray-600 mt-2">
        <b>WASD / arrows</b> drive · <b>Space</b> shoot · ❤️ health · ⚡ speed · 🔥 rapid · 🛡️ shield · 💀 bomb · 🔱 triple · ❄️ freeze · 🧨 mines
      </p>

      {confirmLeave && <LeaveModal />}
    </div>
  );
}
