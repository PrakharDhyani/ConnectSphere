import Joi from "joi";

export const createRoomSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  visibility: Joi.string().valid("public", "private").default("private"),
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
