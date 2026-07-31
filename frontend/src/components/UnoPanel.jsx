/**
 * UNO — table UI. Cards are pure CSS (gradient faces, oval sheen, corner
 * pips) so they render crisp at any size with zero assets. Your hand fans at
 * the bottom; playable cards lift and glow on your turn; wilds open a color
 * picker; the discard pile rotates cards randomly like a real messy pile.
 */
import { useEffect, useRef, useState } from "react";
import { useLobbyGame } from "@/hooks/useLobbyGame.js";
import GameLobby, { SpectateBanner, NoticeFeed } from "@/components/GameLobby.jsx";
import Button from "@/components/ui/Button.jsx";
import { sfx } from "@/lib/sfx.js";

const CARD_BG = {
  red: "linear-gradient(145deg,#ff6b6b,#d92020 60%,#a81515)",
  yellow: "linear-gradient(145deg,#ffd93d,#e8b400 60%,#b78d00)",
  green: "linear-gradient(145deg,#6ee77e,#1fa93a 60%,#157a2a)",
  blue: "linear-gradient(145deg,#5ea8ff,#1e6fd9 60%,#1450a0)",
  wild: "conic-gradient(#d92020 0 25%, #e8b400 25% 50%, #1fa93a 50% 75%, #1e6fd9 75% 100%)",
};
const COLOR_DOT = { red: "#ef4444", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6" };

function faceOf(value) {
  switch (value) {
    case "skip": return "⊘";
    case "reverse": return "⇄";
    case "draw2": return "+2";
    case "wild": return "★";
    case "wild4": return "+4";
    default: return value;
  }
}

export function UnoCard({ card, size = 1, onClick, disabled, lifted, style }) {
  const w = 64 * size, h = 96 * size;
  const face = faceOf(card.value);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative rounded-xl shrink-0 select-none"
      style={{
        width: w, height: h,
        background: CARD_BG[card.color],
        border: "3px solid #f8fafc",
        boxShadow: lifted
          ? "0 0 14px rgba(34,211,238,0.8), 0 8px 16px rgba(0,0,0,0.5)"
          : "0 3px 8px rgba(0,0,0,0.5)",
        transform: lifted ? "translateY(-14px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s",
        cursor: onClick && !disabled ? "pointer" : "default",
        ...style,
      }}
    >
      {/* the classic slanted oval */}
      <span
        className="absolute inset-0 m-auto rounded-[50%]"
        style={{
          width: w * 0.78, height: h * 0.62,
          background: "rgba(255,255,255,0.92)",
          transform: "rotate(-30deg)",
        }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center font-black"
        style={{
          fontSize: (card.value.length > 1 ? 26 : 34) * size,
          color: card.color === "wild" ? "#1a1a2e" : CARD_BG[card.color].includes("e8b400") ? "#8a6d00" : "#111",
          textShadow: "0 1px 0 rgba(255,255,255,0.6)",
        }}
      >
        {face}
      </span>
      <span className="absolute top-0.5 left-1.5 text-white font-bold" style={{ fontSize: 11 * size }}>{face}</span>
      <span className="absolute bottom-0.5 right-1.5 text-white font-bold rotate-180" style={{ fontSize: 11 * size }}>{face}</span>
    </button>
  );
}

function CardBack({ size = 1, style }) {
  return (
    <div
      className="relative rounded-xl shrink-0"
      style={{
        width: 64 * size, height: 96 * size,
        background: "linear-gradient(145deg,#1a1a2e,#0d0d1a)",
        border: "3px solid #f8fafc",
        boxShadow: "0 3px 8px rgba(0,0,0,0.5)",
        ...style,
      }}
    >
      <span className="absolute inset-0 m-auto rounded-[50%] flex items-center justify-center font-black text-arcade-400"
        style={{ width: 64 * size * 0.78, height: 96 * size * 0.62, background: "#252547", transform: "rotate(-30deg)", fontSize: 18 * size }}>
        UNO
      </span>
    </div>
  );
}

export default function UnoPanel({ roomId }) {
  const lobby = useLobbyGame("uno", roomId);
  const { me, state, priv, notices, isHost, act, reset } = lobby;
  const [wildIdx, setWildIdx] = useState(null); // card awaiting color choice
  const [err, setErr] = useState(null);

  const myTurn = state?.turnId === me?.id && !state?.winnerId;
  const hand = priv?.hand || [];

  // Sound cues from notices + state diffs.
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state || state.status !== "playing") {
      if (prev?.status === "playing" && state?.winnerId) sfx.play(state.winnerId === me?.id ? "win" : "lose");
      return;
    }
    if (state.top && prev.top && (state.top.value !== prev.top.value || state.top.color !== prev.top.color)) {
      sfx.play("cardPlay");
      if (state.top.value === "reverse") sfx.play("reverse");
      if (state.top.value === "draw2" || state.top.value === "wild4") sfx.play("plusCard");
    }
    if (state.turnId === me?.id && prev.turnId !== me?.id) sfx.play("yourTurn");
  }, [state, me]);
  useEffect(() => {
    const last = notices[notices.length - 1];
    if (last?.text.includes("UNO!")) sfx.play("unoShout");
  }, [notices]);

  if (!state || state.status === "lobby") {
    return (
      <GameLobby
        title="UNO" emoji="🃏" tagline="Match the color or number — first to empty their hand wins. 2–6 players."
        minPlayers={2} maxPlayers={6} lobby={lobby}
      />
    );
  }

  const seatedIds = state.players?.map((p) => p.id) || [];
  const mySeat = seatedIds.includes(me?.id);
  const doPlay = async (i) => {
    setErr(null);
    const card = hand[i];
    if (card.color === "wild") { setWildIdx(i); return; }
    const res = await act("play", { cardIdx: i });
    if (res?.error) setErr(res.error);
  };
  const doWild = async (color) => {
    const i = wildIdx;
    setWildIdx(null);
    const res = await act("play", { cardIdx: i, color });
    if (res?.error) setErr(res.error);
  };
  const doDraw = async () => {
    setErr(null);
    sfx.play("cardDraw");
    const res = await act("draw");
    if (res?.error) setErr(res.error);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {!mySeat && <SpectateBanner />}

      {/* Opponents around the table */}
      <div className="flex flex-wrap justify-center gap-3">
        {state.players?.filter((p) => p.id !== me?.id).map((p) => (
          <div key={p.id}
            className={`flex flex-col items-center px-3 py-2 rounded-xl border transition-all ${
              state.turnId === p.id && !state.winnerId
                ? "border-arcade-400 bg-arcade-950/50 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                : "border-gray-800 bg-gray-900/60"
            }`}>
            <span className="text-xs text-gray-300 mb-1">
              {p.name}{p.isBot && " 🤖"}
              {state.counts?.[p.id] === 1 && <span className="ml-1 text-amber-300 font-bold animate-pulse">UNO!</span>}
            </span>
            <div className="flex" style={{ marginLeft: 8 }}>
              {Array.from({ length: Math.min(state.counts?.[p.id] ?? 0, 8) }, (_, i) => (
                <CardBack key={i} size={0.42} style={{ marginLeft: -18, transform: `rotate(${(i - 3) * 4}deg)` }} />
              ))}
            </div>
            <span className="text-[11px] text-gray-500 mt-0.5">{state.counts?.[p.id]} cards</span>
          </div>
        ))}
      </div>

      {/* Table center: draw pile · top card · direction */}
      <div className="flex items-center justify-center gap-6 py-2">
        <button onClick={myTurn && !state.pendingDraw ? doDraw : undefined}
          className={myTurn && !state.pendingDraw ? "hover:-translate-y-1 transition-transform" : "opacity-80"}
          title={state.stack ? `Draw ${state.stack.count}!` : "Draw a card"}>
          <CardBack size={1} />
          <span className="block text-center text-[11px] mt-1">
            {state.stack && myTurn
              ? <b className="text-red-400">draw {state.stack.count}!</b>
              : <span className="text-gray-500">{state.drawPileCount} left</span>}
          </span>
        </button>
        {state.top && (
          <div className="relative">
            <UnoCard card={state.top} size={1.25} style={{ transform: `rotate(${(state.drawPileCount % 7) - 3}deg)` }} />
            {/* Active color halo (matters after wilds) */}
            <span className="absolute -inset-2 rounded-2xl -z-10"
              style={{ boxShadow: `0 0 22px 6px ${COLOR_DOT[state.activeColor]}66` }} />
            {/* Live stack pile-up badge */}
            {state.stack && (
              <span className="absolute -top-3 -right-4 z-10 px-2.5 py-1 rounded-full bg-red-600 text-white font-black text-lg animate-pulse shadow-[0_0_14px_rgba(239,68,68,0.8)]">
                +{state.stack.count}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col items-center text-3xl w-16">
          <span style={{ transform: state.direction === 1 ? "none" : "scaleX(-1)" }} className="transition-transform duration-500">
            {state.direction === 1 ? "🔃" : "🔄"}
          </span>
          <span className="text-[11px] text-gray-500 mt-1">
            {state.winnerId ? "game over" : state.turnId === me?.id ? "your turn!" : `${state.players?.find((p) => p.id === state.turnId)?.name}'s turn`}
          </span>
        </div>
      </div>

      <NoticeFeed notices={notices} />
      {err && <p className="text-center text-sm text-red-400">{err}</p>}

      {/* Winner banner */}
      {state.winnerId && (
        <div className="text-center space-y-2">
          <p className="text-xl font-black text-arcade-300">
            🏆 {state.players?.find((p) => p.id === state.winnerId)?.name} wins!
          </p>
          {isHost && <Button variant="arcade" onClick={reset}>Play again</Button>}
        </div>
      )}

      {/* Your hand — fanned; playable cards lift on hover */}
      {mySeat && !state.winnerId && (
        <div className="pt-2">
          <div className="flex justify-center" style={{ paddingLeft: 24 }}>
            {hand.map((card, i) => {
              // Stack-aware: while a +2/+4 pile is live, only the same card
              // type answers it (server enforces; this mirrors for UX).
              const playable = myTurn && (state.stack
                ? card.value === state.stack.type
                : card.color === "wild" || card.color === state.activeColor || card.value === state.top?.value);
              const drawnPending = priv?.pendingDraw === i;
              return (
                <div key={`${card.color}-${card.value}-${i}`} style={{ marginLeft: i === 0 ? 0 : Math.max(-30, -hand.length * 2 - 14) }}>
                  <UnoCard
                    card={card}
                    size={0.95}
                    onClick={playable ? () => doPlay(i) : undefined}
                    disabled={!playable}
                    lifted={drawnPending}
                    style={{
                      transform: `rotate(${(i - hand.length / 2) * 3}deg) ${drawnPending ? "translateY(-14px)" : ""}`,
                      opacity: myTurn && !playable ? 0.55 : 1,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-center gap-2 mt-3 min-h-[2.2rem]">
            {myTurn && state.pendingDraw && (
              <Button variant="secondary" onClick={() => act("pass")}>Keep it — pass</Button>
            )}
          </div>
        </div>
      )}

      {/* Wild color picker */}
      {wildIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setWildIdx(null)}>
          <div className="bg-gray-900 border border-arcade-500/40 rounded-2xl p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold mb-3">Pick a color</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(COLOR_DOT).map(([c, hex]) => (
                <button key={c} onClick={() => doWild(c)}
                  className="w-20 h-20 rounded-xl font-bold text-white capitalize hover:scale-105 transition-transform"
                  style={{ background: hex, boxShadow: `0 0 14px ${hex}88` }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
