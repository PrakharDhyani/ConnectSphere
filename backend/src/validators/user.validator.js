import Joi from "joi";

// PATCH /users/me — partial update: every field optional, but the request
// must change *something* (min(1) rejects an empty body). Avatar goes through
// its own upload endpoint, and role/email are deliberately absent — stripUnknown
// in validate() silently drops any attempt to smuggle them in.
export const updateMeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
}).min(1);
