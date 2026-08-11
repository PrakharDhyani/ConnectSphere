/**
 * The plugin registry — manifests only.
 *
 * WHY NOT IMPLEMENTATIONS: registering React components or socket handlers
 * here would pull every plugin into the initial bundle and destroy the lazy
 * loading the app already relies on (Excalidraw ~1.8 MB, chess.js, the 3D kart
 * arena). The registry answers "what exists and what does it need?"; the
 * runtime separately answers "give me the code" at mount time.
 *
 * WHY VALIDATE AT REGISTRATION: this runs at server boot and bundle init, so a
 * malformed plugin is a startup crash naming the exact field — not a blank tab
 * for one user in production.
 *
 * This module is isomorphic: plain ESM, no imports beyond its siblings, safe in
 * Node and the browser.
 */
import { validateManifest, freezeManifest } from "./manifest.js";
import { SCORABLE_PURPOSE_IDS } from "./purposes.js";
import { defaultsFor } from "./config-schema.js";
import { verifyManifestOrigin } from "./provenance.js";

const plugins = new Map();

/**
 * Register a manifest. Throws on invalid input or a duplicate id.
 *
 * Note the extra check that `recommendedFor` keys are real purposes: a typo
 * like `recommendedFor: { studdy: 1 }` is otherwise silent — the plugin simply
 * never gets recommended, and nobody discovers why for months.
 */
export function registerPlugin(manifest) {
  validateManifest(manifest);
  /**
   * Provenance is checked HERE because registration is the only path every
   * manifest takes — server boot and bundle init both funnel through it, so a
   * verifier installed by the host cannot be bypassed by a caller who forgot
   * to ask. Same reasoning that put shape validation here rather than at each
   * call site. With no verifier installed this accepts built-ins and refuses
   * anything claiming a remote origin; see provenance.js for why it fails
   * closed rather than open.
   */
  const provenance = verifyManifestOrigin(manifest);
  if (plugins.has(manifest.id)) {
    throw new Error(`Duplicate plugin id "${manifest.id}" — ids must be unique across the registry`);
  }
  for (const purpose of Object.keys(manifest.recommendedFor || {})) {
    if (!SCORABLE_PURPOSE_IDS.includes(purpose)) {
      throw new Error(
        `Plugin "${manifest.id}": recommendedFor."${purpose}" is not a known purpose. ` +
        `Known: ${SCORABLE_PURPOSE_IDS.join(", ")}`
      );
    }
  }
  // `provenance` is derived, not client-supplied: storing it on the frozen
  // entry means a later consumer (a marketplace UI, an audit log) reads the
  // verified answer rather than re-deriving it from the raw manifest and
  // possibly disagreeing with the gate above.
  plugins.set(manifest.id, freezeManifest({ ...manifest, provenance }));
  return plugins.get(manifest.id);
}

export const getPlugin = (id) => plugins.get(id) ?? null;
export const hasPlugin = (id) => plugins.has(id);
export const getAllPlugins = () => [...plugins.values()];
export const getPluginsByCategory = (category) => getAllPlugins().filter((p) => p.category === category);
export const getPluginsBySurface = (surface) => getAllPlugins().filter((p) => p.surface === surface);

/**
 * Plugins relevant to a purpose, best first. The full scoring engine (with
 * co-occurrence, visibility fit and generated reasons) lands in Phase 2; this
 * is the purpose-weight slice of it, so callers can already ask the registry
 * rather than hardcoding lists.
 */
export function getRecommendedPlugins(purpose, { minWeight = 0.5 } = {}) {
  return getAllPlugins()
    .filter((p) => (p.recommendedFor?.[purpose] ?? 0) >= minWeight)
    .sort((a, b) => (b.recommendedFor[purpose] ?? 0) - (a.recommendedFor[purpose] ?? 0));
}

/** The default config for a plugin — every field's declared default. */
export function getDefaultConfig(id) {
  const p = plugins.get(id);
  return p ? defaultsFor(p.configSchema) : {};
}

/**
 * Verify every `requires` points at a registered plugin, and that there are no
 * dependency cycles.
 *
 * Deliberately NOT done inside registerPlugin: a plugin may legitimately be
 * registered before its dependency, so the graph is only meaningful once all
 * manifests are in. Called once by index.js after registration.
 */
export function validateDependencies() {
  for (const p of plugins.values()) {
    for (const dep of p.requires || []) {
      if (!plugins.has(dep)) {
        throw new Error(`Plugin "${p.id}" requires "${dep}", which is not registered`);
      }
    }
  }
  // Iterative DFS with a colour marking — recursion would blow the stack on a
  // pathological graph, and this reports the actual cycle path, which is the
  // only genuinely useful thing to say about one.
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map([...plugins.keys()].map((id) => [id, WHITE]));

  for (const start of plugins.keys()) {
    if (colour.get(start) !== WHITE) continue;
    const stack = [{ id: start, path: [start] }];
    while (stack.length) {
      const { id, path } = stack.pop();
      if (colour.get(id) === BLACK) continue;
      colour.set(id, GREY);
      let hasUnvisited = false;
      for (const dep of plugins.get(id).requires || []) {
        if (colour.get(dep) === GREY) {
          throw new Error(`Plugin dependency cycle: ${[...path, dep].join(" → ")}`);
        }
        if (colour.get(dep) === WHITE) {
          hasUnvisited = true;
          stack.push({ id: dep, path: [...path, dep] });
        }
      }
      if (!hasUnvisited) colour.set(id, BLACK);
    }
    // Everything reachable from `start` is settled.
    for (const [k, v] of colour) if (v === GREY) colour.set(k, BLACK);
  }
  return true;
}

/**
 * Test-only. Module state is a singleton by design (one catalogue per process),
 * so tests that register throwaway manifests need a way back to a clean slate.
 */
export function __resetRegistry() {
  plugins.clear();
}

/**
 * Test-only: drop ONE plugin, leaving the rest of the catalogue intact.
 *
 * `__resetRegistry()` is the blunt instrument, and it has a trap — the built-in
 * registration short-circuits on its own `registered` flag, so clearing the map
 * and calling `registerBuiltInActivities()` again is a no-op and leaves an
 * EMPTY catalogue for everything that follows. A test that only needs to add a
 * synthetic manifest should remove exactly that one instead.
 */
export function __unregisterPlugin(id) {
  return plugins.delete(id);
}
