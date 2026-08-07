import Joi from "joi";

/**
 * Create a room.
 *
 * `purpose` and `activities` are OPTIONAL and additive — the original
 * `{name, visibility}` body stays valid, so older clients (and the one-click
 * "just make me a room" path in the wizard) keep working unchanged. That is
 * what makes the wizard safe to roll out.
 *
 * Per-plugin `config` is deliberately NOT validated here: Joi cannot know each
 * plugin's schema. It is validated and clamped against the manifest's
 * configSchema in the controller (coerceConfig) — the same trust boundary as
 * sanitizeAttachments for chat. Joi only enforces the envelope.
 */
export const createRoomSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  visibility: Joi.string().valid("public", "private", "inviteOnly").default("private"),
  purpose: Joi.object({
    kind: Joi.string().trim().max(30).allow(null, ""),
    // Only meaningful when kind === "custom"; harmless otherwise.
    text: Joi.string().trim().max(200).allow(null, ""),
  }).optional(),
  activities: Joi.array()
    .max(32) // more than the catalogue; a guard, not a policy
    .items(
      Joi.object({
        id: Joi.string().trim().max(32).required(),
        config: Joi.object().unknown(true).default({}),
      })
    )
    .optional(),
});

// Rename is the same single-field rule as create — kept separate so the two
// can't silently drift if one changes later.
export const renameRoomSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
});

// Join codes are 6 lowercase hex chars (see Room.generateCode). Normalizing
// case here means "A1B2C3" read over the phone still works.
export const joinRoomSchema = Joi.object({
  code: Joi.string().trim().lowercase().length(6).hex().required(),
});
