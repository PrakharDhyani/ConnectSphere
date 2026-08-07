/**
 * Activity recommendation engine — data-driven, no if/else chains.
 *
 * WHY SCORING RATHER THAN `if (purpose === "coding") return [...]`
 * A hardcoded mapping has to be edited for every new plugin AND every new
 * purpose — the N×M problem the whole plugin system exists to avoid. Here each
 * manifest declares its own affinity (`recommendedFor`), so a plugin arrives
 * already knowing where it belongs and no central list needs touching.
 *
 * It also makes the output explainable. Because the score is a sum of named
 * signals, we can say WHY something is recommended ("Popular for study rooms",
 * "Pairs well with Whiteboard") instead of presenting an unsourced list. That
 * is the difference between a recommendation feeling deliberate and feeling
 * random — and it is free once the scoring is data-driven.
 *
 * Every weight below is a tunable constant, and the co-occurrence table is
 * static seed data that can later be recomputed from real installs without
 * changing a line of this logic.
 */
import { getAllPlugins, getPlugin } from "./registry.js";

export const WEIGHTS = Object.freeze({
  purpose: 1.0,     // the primary signal — what the user told us the room is for
  cooccurrence: 0.35, // "people who picked X also picked Y"
  visibility: 0.15,
  interest: 0.25,
  popularity: 0.1,  // tiebreaker only; never enough to promote on its own
});

/**
 * Seed co-occurrence: plugins that genuinely work well together.
 *
 * Symmetric by construction (see `affinity`) so the table only lists each pair
 * once. Values are hand-seeded now; the interface does not change when this is
 * recomputed from real install data later.
 */
const COOCCURRENCE = Object.freeze({
  "whiteboard|poll": 0.6,
  "whiteboard|skribbl": 0.7,
  "poll|bingo": 0.4,
  "ludo|uno": 0.8,
  "ludo|bingo": 0.6,
  "uno|bingo": 0.6,
  "chess|typing": 0.5,
  "skribbl|ludo": 0.6,
  "skribbl|uno": 0.6,
  "kart|ludo": 0.5,
  "kart|uno": 0.4,
  "typing|bingo": 0.4,
});

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function cooccurrence(pluginId, selectedIds) {
  if (!selectedIds?.length) return 0;
  // Best single pairing, not the sum: a plugin that pairs strongly with one
  // chosen activity should not be out-ranked by one that pairs weakly with
  // five. Sums also grow without bound as the selection does.
  let best = 0;
  for (const id of selectedIds) {
    if (id === pluginId) continue;
    best = Math.max(best, COOCCURRENCE[pairKey(pluginId, id)] ?? 0);
  }
  return best;
}

/**
 * Public rooms skew towards things that survive strangers: turn-based games
 * with clear rules, polls. A shared canvas in a public room is the first thing
 * to get defaced, so it is nudged down — not excluded, just not promoted.
 */
function visibilityFit(manifest, visibility) {
  if (visibility === "public") {
    if (manifest.category === "games") return 0.8;
    if (manifest.id === "poll") return 0.9;
    if (manifest.surface === "board") return 0.3;
    return 0.5;
  }
  // private / inviteOnly: people know each other, collaboration is safe
  if (manifest.surface === "board") return 0.9;
  return 0.6;
}

function interestMatch(manifest, interests) {
  if (!interests?.length) return 0;
  const hay = `${manifest.id} ${manifest.name} ${manifest.category} ${manifest.description}`.toLowerCase();
  const hits = interests.filter((i) => typeof i === "string" && i.trim() && hay.includes(i.toLowerCase().trim()));
  return interests.length ? hits.length / interests.length : 0;
}

/** Human-readable reasons, generated from whichever signals actually fired. */
function reasonsFor({ manifest, purposeScore, coScore, coPartner, visScore, interestScore, purposeLabel }) {
  const out = [];
  if (purposeScore >= 0.8) out.push(`Made for ${purposeLabel} rooms`);
  else if (purposeScore >= 0.5) out.push(`Often used for ${purposeLabel}`);
  if (coScore >= 0.5 && coPartner) out.push(`Pairs well with ${getPlugin(coPartner)?.name ?? coPartner}`);
  if (interestScore > 0) out.push("Matches your interests");
  if (!out.length && visScore >= 0.8) out.push("Works well in this kind of room");
  if (!out.length) out.push("Popular choice");
  return out;
}

/** Which already-selected plugin drove the co-occurrence score (for the reason). */
function bestPartner(pluginId, selectedIds) {
  let best = null, bestVal = 0;
  for (const id of selectedIds || []) {
    if (id === pluginId) continue;
    const v = COOCCURRENCE[pairKey(pluginId, id)] ?? 0;
    if (v > bestVal) { bestVal = v; best = id; }
  }
  return best;
}

/**
 * Score every plugin for a room being created.
 *
 * @param {object} ctx
 * @param {string} ctx.purpose       purpose id ("study"), or "custom"/null
 * @param {string[]} ctx.selected    plugin ids already chosen
 * @param {string} ctx.visibility    public | private | inviteOnly
 * @param {string[]} ctx.interests   free-text interests (optional)
 * @param {string} ctx.purposeLabel  display label used in reasons
 * @returns {Array<{id,name,icon,description,category,score,tier,reasons}>}
 */
export function scoreActivities({ purpose, selected = [], visibility = "private", interests = [], purposeLabel } = {}) {
  const label = purposeLabel || purpose || "this";

  const scored = getAllPlugins().map((manifest) => {
    // "custom" and unknown purposes contribute NO purpose signal — which is
    // honest: we genuinely do not know what the room is for, so the ranking
    // falls back to popularity and pairings rather than inventing a fit.
    const purposeScore = purpose && purpose !== "custom" ? (manifest.recommendedFor?.[purpose] ?? 0) : 0;
    const coScore = cooccurrence(manifest.id, selected);
    const visScore = visibilityFit(manifest, visibility);
    const interestScore = interestMatch(manifest, interests);
    // Popularity proxy: how many purposes a plugin is broadly useful for.
    // A real install-rate replaces this later without touching callers.
    const affinities = Object.values(manifest.recommendedFor || {});
    const popularity = affinities.length ? affinities.reduce((a, b) => a + b, 0) / affinities.length : 0;

    const score =
      WEIGHTS.purpose * purposeScore +
      WEIGHTS.cooccurrence * coScore +
      WEIGHTS.visibility * visScore +
      WEIGHTS.interest * interestScore +
      WEIGHTS.popularity * popularity;

    return {
      id: manifest.id,
      name: manifest.name,
      icon: manifest.icon,
      description: manifest.description,
      category: manifest.category,
      surface: manifest.surface,
      score: Math.round(score * 1000) / 1000,
      signals: { purpose: purposeScore, cooccurrence: coScore, visibility: visScore, interest: interestScore, popularity },
      reasons: reasonsFor({
        manifest, purposeScore, coScore,
        coPartner: bestPartner(manifest.id, selected),
        visScore, interestScore, purposeLabel: label,
      }),
    };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  /**
   * Tier by RELATIVE score, not an absolute cutoff.
   *
   * An absolute threshold breaks for purposes with few strong matches — pick
   * "music" today and every plugin falls below it, leaving an empty list and a
   * dead end in the wizard. Relative tiering always yields a usable shortlist,
   * whatever the catalogue happens to contain.
   *
   * MIN_RECOMMENDED exists because a relative cutoff has the opposite failure:
   * when one plugin dominates (Coding → Whiteboard scores far above the rest)
   * a strict ratio leaves a "shortlist" of one, which reads as broken rather
   * than selective. Always offer at least a few, capped so the recommended set
   * stays a recommendation rather than the catalogue with extra steps.
   */
  const MIN_RECOMMENDED = 4;
  const MAX_RECOMMENDED = 6;
  const selectedSet = new Set(selected);
  // Already-chosen plugins must not occupy a recommendation slot — suggesting
  // what the user just picked wastes the shortlist.
  const candidates = scored.filter((s) => !selectedSet.has(s.id));
  const top = candidates[0]?.score ?? 0;
  const cutoff = top * 0.6;

  let recommendedCount = candidates.filter((s) => s.score >= cutoff).length;
  recommendedCount = Math.min(MAX_RECOMMENDED, Math.max(MIN_RECOMMENDED, recommendedCount));
  const recommendedIds = new Set(candidates.slice(0, recommendedCount).map((s) => s.id));

  return scored.map((s) => ({
    ...s,
    selected: selectedSet.has(s.id),
    tier: recommendedIds.has(s.id) ? "recommended" : "optional",
  }));
}

/** Convenience split for the wizard. */
export function recommendForRoom(ctx) {
  const all = scoreActivities(ctx);
  return {
    recommended: all.filter((a) => a.tier === "recommended"),
    optional: all.filter((a) => a.tier === "optional"),
    all,
  };
}
