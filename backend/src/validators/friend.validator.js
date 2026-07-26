import Joi from "joi";

export const requestSchema = Joi.object({
  userId: Joi.string().required(),
});

export const inviteSchema = Joi.object({
  friendId: Joi.string().required(),
  roomId: Joi.string().required(),
});
