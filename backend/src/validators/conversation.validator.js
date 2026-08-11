import Joi from "joi";

/**
 * Opening a DM takes only the other person's id — everything else about the
 * conversation (participants, key, read state) is derived server-side from the
 * authenticated caller. A client that could name both participants could open a
 * thread between two other people.
 */
export const openConversationSchema = Joi.object({
  userId: Joi.string().required(),
});
