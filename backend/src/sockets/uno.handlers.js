/**
 * UNO — socket wiring on the shared lobby framework.
 *
 * Hands are PRIVATE: public state carries only counts; each seated player
 * receives their own hand via the framework's privateState channel. All rule
 * mutations live in games/unoGame.js (pure, tested); this file is glue.
 */
import { createLobbyGame } from "./lobbyGame.js";
import * as U from "../games/unoGame.js";

const TURN_MS = 25_000;
const AFK_LIMIT = 3;

const order = (g) => g.players.map((p) => p.id);
const turnId = (g) => order(g)[g.uno.turnIdx];
const nameOf = (g, id) => g.players.find((p) => p.id === id)?.name || "?";

function announceEffects(ctx, playerId, effects) {
  const { g } = ctx;
  if (effects.uno) ctx.notice(`🗣️ ${nameOf(g, playerId)} shouts UNO!`);
  if (effects.drew) ctx.notice(`🃏 ${nameOf(g, effects.drew.playerId)} draws ${effects.drew.n}`);
  if (effects.reversed) ctx.notice("🔄 Direction reversed");
}

function afterAction(ctx) {
  const { g } = ctx;
  if (g.uno.winnerId) {
    g.winnerId = g.uno.winnerId;
    ctx.notice(`🏆 ${nameOf(g, g.winnerId)} wins!`);
    ctx.endGame();
    return;
  }
  ctx.broadcast();
}

// A fully-auto turn for AFK humans: play a random legal card or draw+pass.
function autoPlay(ctx, playerId) {
  const { g } = ctx;
  const choice = U.botChoose(g.uno, order(g), playerId, "easy", null);
  if (choice.draw) {
    U.drawCards(g.uno, playerId, 1);
    const hand = g.uno.hands[playerId];
    const idx = hand.length - 1;
    if (U.canPlay(hand[idx], U.top(g.uno), g.uno.activeColor)) {
      const res = U.playCard(g.uno, order(g), playerId, idx, U.bestColor(hand));
      if (res.ok) announceEffects(ctx, playerId, res.effects);
    } else {
      U.advance(g.uno, order(g), 1);
    }
  } else {
    const res = U.playCard(g.uno, order(g), playerId, choice.cardIdx, choice.chosenColor);
    if (res.ok) announceEffects(ctx, playerId, res.effects);
  }
  afterAction(ctx);
}

function kickSeat(ctx, playerId) {
  const { g } = ctx;
  ctx.notice(`🚪 ${nameOf(g, playerId)} was removed — inactive for ${AFK_LIMIT} turns`);
  const idx = order(g).indexOf(playerId);
  // Their cards go back under the draw pile; the seat disappears.
  g.uno.drawPile.unshift(...(g.uno.hands[playerId] || []));
  delete g.uno.hands[playerId];
  g.players.splice(idx, 1);
  if (idx < g.uno.turnIdx || g.uno.turnIdx >= g.players.length) {
    g.uno.turnIdx = (g.uno.turnIdx - 1 + g.players.length) % g.players.length;
  }
  if (g.hostId === playerId) g.hostId = g.players.find((p) => !p.isBot)?.id || g.hostId;
  if (g.players.length === 1) {
    g.winnerId = g.players[0].id;
    ctx.notice(`🏆 ${nameOf(g, g.winnerId)} wins by default!`);
    ctx.endGame();
    return;
  }
  if (turnId(g) === undefined) g.uno.turnIdx = 0;
  ctx.broadcast();
}

const uno = createLobbyGame({
  prefix: "uno",
  minPlayers: 2,
  maxPlayers: 6,
  allowBots: true,

  init: () => ({ uno: null, winnerId: null, afk: {} }),

  start(g) {
    g.uno = U.setup(order(g));
    g.winnerId = null;
    g.afk = {};
  },

  publicState(g) {
    if (!g.uno) return { winnerId: null };
    return {
      top: U.top(g.uno),
      activeColor: g.uno.activeColor,
      direction: g.uno.direction,
      turnId: turnId(g),
      counts: Object.fromEntries(Object.entries(g.uno.hands).map(([id, h]) => [id, h.length])),
      drawPileCount: g.uno.drawPile.length,
      pendingDraw: g.uno.pendingDraw !== null,
      winnerId: g.winnerId,
    };
  },

  privateState(g, playerId) {
    if (!g.uno?.hands[playerId]) return null;
    return { hand: g.uno.hands[playerId], pendingDraw: turnId(g) === playerId ? g.uno.pendingDraw : null };
  },

  events: {
    play(ctx, { playerId, cardIdx, color }, cb) {
      const { g } = ctx;
      if (turnId(g) !== playerId) return cb?.({ error: "Not your turn" });
      const res = U.playCard(g.uno, order(g), playerId, cardIdx, color);
      if (res.error) return cb?.({ error: res.error });
      g.afk[playerId] = 0;
      announceEffects(ctx, playerId, res.effects);
      afterAction(ctx);
      cb?.({ ok: true });
    },

    draw(ctx, { playerId }, cb) {
      const { g } = ctx;
      if (turnId(g) !== playerId) return cb?.({ error: "Not your turn" });
      if (g.uno.pendingDraw !== null) return cb?.({ error: "Play or keep your drawn card" });
      g.afk[playerId] = 0;
      U.drawCards(g.uno, playerId, 1);
      const hand = g.uno.hands[playerId];
      const idx = hand.length - 1;
      if (U.canPlay(hand[idx], U.top(g.uno), g.uno.activeColor)) {
        // Playable: the player chooses — play it or keep it (pass).
        g.uno.pendingDraw = idx;
        ctx.broadcast();
      } else {
        U.advance(g.uno, order(g), 1);
        ctx.broadcast();
      }
      cb?.({ ok: true });
    },

    pass(ctx, { playerId }, cb) {
      const { g } = ctx;
      if (turnId(g) !== playerId) return cb?.({ error: "Not your turn" });
      if (g.uno.pendingDraw === null) return cb?.({ error: "You can only pass after drawing" });
      g.uno.pendingDraw = null;
      g.afk[playerId] = 0;
      U.advance(g.uno, order(g), 1);
      ctx.broadcast();
      cb?.({ ok: true });
    },
  },

  afkDeadline(g) {
    const seat = g.players.find((p) => p.id === turnId(g));
    if (!seat || seat.isBot) return null;
    return Date.now() + TURN_MS;
  },

  onAfkTimeout(ctx) {
    const { g } = ctx;
    const id = turnId(g);
    g.afk[id] = (g.afk[id] || 0) + 1;
    if (g.afk[id] >= AFK_LIMIT) return kickSeat(ctx, id);
    ctx.notice(`⏰ Auto-playing for ${nameOf(g, id)} (${g.afk[id]}/${AFK_LIMIT})`);
    autoPlay(ctx, id);
  },

  botTurn(g) {
    return Boolean(g.players.find((p) => p.id === turnId(g))?.isBot);
  },
  botDelayMs(g) {
    const d = g.players.find((p) => p.id === turnId(g))?.difficulty;
    return d === "hard" ? 900 : d === "easy" ? 1600 : 1200;
  },
  botAct(ctx) {
    const { g } = ctx;
    const id = turnId(g);
    const seat = g.players.find((p) => p.id === id);
    const counts = Object.fromEntries(Object.entries(g.uno.hands).map(([pid, h]) => [pid, h.length]));
    const choice = U.botChoose(g.uno, order(g), id, seat.difficulty, counts);
    if (choice.draw) {
      U.drawCards(g.uno, id, 1);
      const hand = g.uno.hands[id];
      const idx = hand.length - 1;
      if (U.canPlay(hand[idx], U.top(g.uno), g.uno.activeColor)) {
        const res = U.playCard(g.uno, order(g), id, idx, U.bestColor(hand));
        if (res.ok) announceEffects(ctx, id, res.effects);
      } else {
        U.advance(g.uno, order(g), 1);
      }
    } else {
      const res = U.playCard(g.uno, order(g), id, choice.cardIdx, choice.chosenColor);
      if (res.ok) announceEffects(ctx, id, res.effects);
    }
    afterAction(ctx);
  },
});

export function registerUnoHandlers(io, socket) {
  uno.register(io, socket);
}
