/**
 * Version resolution — comparing what a room PINNED against what this build HAS.
 *
 * THE GAP THIS CLOSES
 * `installed[].version` has been pinned at install time since Phase 4, carried
 * through every edit, and surfaced by the compat resolver. Nothing ever
 * *compared* it. So the pin recorded history and changed no behaviour: a plugin
 * could go 1.0.0 → 2.0.0, rewrite its config grammar, and every existing room
 * would silently adopt the new one — which is the exact scenario pinning was
 * introduced to prevent. A pin nobody reads is a comment.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * Not a resolver that runs OLD CODE for old rooms. One build ships one
 * implementation per plugin; keeping several live would mean versioned modules,
 * a loader and a support burden that a marketplace might justify and a
 * single-server hangout app never will. What it does instead is make drift
 * *legible* — the room knows it is pinned to 1.x while the server runs 2.x, and
 * callers decide what that means. That is the seam; the policy sits on top.
 *
 * SEMVER, AND WHY ONLY THE MAJOR MATTERS HERE
 * `manifest.js` already enforces `\d+.\d+.\d+`, so parsing is total — no ranges,
 * no pre-release tags, no `^`/`~`. A MAJOR bump is the plugin author declaring
 * "this is not backwards compatible", and that is the only difference a room can
 * act on: minor and patch are by definition safe to adopt silently, which is
 * what makes them minor and patch. Treating every bump as a migration would make
 * a typo fix in a description an upgrade prompt.
 *
 * Isomorphic: plain ESM, no imports, safe in Node and the browser.
 */

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse "1.2.3" into {major, minor, patch}, or null if it is not semver.
 *
 * Returns null rather than throwing: the input can be a version pinned by an
 * older build, and a room must never fail to open because of a field that only
 * exists to inform a badge.
 */
export function parseVersion(v) {
  const m = SEMVER_RE.exec(String(v ?? ""));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Compare two semver strings. -1 / 0 / 1, like every other comparator.
 *
 * Unparseable input sorts as EQUAL rather than lower. "I cannot tell" and "this
 * is older" are different claims, and conflating them would make a corrupt pin
 * look like a pending upgrade.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

/**
 * How a room's pinned version relates to the version this build ships.
 *
 * @returns {"current"|"outdated"|"breaking"|"ahead"|"unpinned"|"unknown"}
 *
 *   current   — same version, or a minor/patch difference. Nothing to do:
 *               compatible by the author's own semver declaration.
 *   outdated  — informational alias kept for callers that want to distinguish
 *               "identical" from "same major, newer build". Also compatible.
 *   breaking  — the build's MAJOR is higher than the pin. The plugin has
 *               declared a break; the room is running config written for a
 *               grammar that no longer applies.
 *   ahead     — the pin is NEWER than the build. Not a bug in the room: it is
 *               a server that has been rolled BACK, or a room synced from an
 *               environment running ahead. Called out separately because the
 *               fix is on the server, not in the room.
 *   unpinned  — a legacy room (installed before pinning) — no claim to make.
 *   unknown   — the plugin is not in this build at all, so there is nothing to
 *               compare against. `resolveActivities()` already flags these
 *               `unavailable`; this keeps the two answers consistent.
 */
export function versionStatus(pinned, current) {
  if (pinned === undefined || pinned === null || pinned === "") return "unpinned";
  if (current === undefined || current === null || current === "") return "unknown";

  const p = parseVersion(pinned);
  const c = parseVersion(current);
  // A pin that predates semver validation, or was hand-edited in the database.
  if (!p || !c) return "unknown";

  if (p.major < c.major) return "breaking";
  if (p.major > c.major) return "ahead";
  if (p.minor !== c.minor || p.patch !== c.patch) return "outdated";
  return "current";
}

/** Does this status mean the room should keep working without intervention? */
export const isCompatible = (status) => status === "current" || status === "outdated" || status === "unpinned";

/**
 * The full picture for one installed entry.
 *
 * Shaped for a caller that wants to render a badge or decide whether to warn:
 * everything needed is here, and nothing needs a second lookup.
 */
export function describeVersion(pinned, current) {
  const status = versionStatus(pinned, current);
  return Object.freeze({
    pinned: pinned || null,
    current: current || null,
    status,
    compatible: isCompatible(status),
    /**
     * Should a human be told? Only for the two states someone can act on.
     * `outdated` is deliberately silent — nagging about a patch bump trains
     * people to ignore the badge that matters.
     */
    needsAttention: status === "breaking" || status === "ahead",
  });
}
