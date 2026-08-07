/**
 * Activity catalogue + recommendations.
 *
 * WHY RECOMMENDATIONS ARE COMPUTED SERVER-SIDE
 * The client *could* run the same engine — manifests are shared — but keeping
 * it here means the co-occurrence table and any future personalisation improve
 * without shipping a new bundle. The client keeps a static fallback so the
 * wizard still works if this endpoint fails; a recommendation is a nicety, and
 * losing it must never block room creation.
 */
import {
  getAllPlugins,
  PURPOSES,
  isValidPurpose,
  getPurpose,
  defaultsFor,
} from "../../../shared/activities/index.js";
import { recommendForRoom } from "../../../shared/activities/recommend.js";

/**
 * What a plugin looks like to the wizard. Deliberately NOT the raw manifest:
 * `permissions` is an internal security detail, and shipping it would invite
 * clients to reason about capabilities they cannot enforce.
 */
function toPublicManifest(m) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    icon: m.icon,
    category: m.category,
    surface: m.surface,
    version: m.version,
    minPlayers: m.minPlayers,
    maxPlayers: m.maxPlayers,
    configSchema: m.configSchema || {},
    defaults: defaultsFor(m.configSchema),
  };
}

// GET /api/activities — the whole catalogue plus the purpose taxonomy.
export async function listActivities(req, res, next) {
  try {
    res.json({
      success: true,
      data: {
        activities: getAllPlugins().map(toPublicManifest),
        purposes: PURPOSES,
      },
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/activities/recommend — scored suggestions for a room being created.
export async function recommendActivities(req, res, next) {
  try {
    const { purpose, selected, visibility, interests } = req.body || {};

    // An unrecognised purpose is not an error: the engine treats it as "no
    // purpose signal" and falls back to popularity, which is the honest
    // answer. Rejecting it would break the wizard for a stale client.
    const kind = isValidPurpose(purpose) ? purpose : null;

    const result = recommendForRoom({
      purpose: kind,
      purposeLabel: getPurpose(kind)?.label || "this",
      // Cheap guards: these come straight from a browser.
      selected: Array.isArray(selected) ? selected.filter((s) => typeof s === "string").slice(0, 32) : [],
      visibility: ["public", "private", "inviteOnly"].includes(visibility) ? visibility : "private",
      interests: Array.isArray(interests) ? interests.filter((s) => typeof s === "string").slice(0, 10) : [],
    });

    const decorate = (list) =>
      list.map((a) => ({ ...a, ...toPublicManifest(getAllPlugins().find((m) => m.id === a.id)) }));

    res.json({
      success: true,
      data: {
        recommended: decorate(result.recommended),
        optional: decorate(result.optional),
      },
    });
  } catch (error) {
    next(error);
  }
}
