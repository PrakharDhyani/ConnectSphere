import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireFullUser } from "../middleware/requireFullUser.js";
import { validate } from "../middleware/validate.js";
import { chatUploadFiles } from "../middleware/chatUpload.js";
import { openConversationSchema } from "../validators/conversation.validator.js";
import {
  openConversation,
  listConversations,
  getConversationMessages,
  markConversationRead,
  clearConversation,
  uploadConversationAttachments,
} from "../controllers/conversation.controller.js";

const router = Router();

/**
 * Direct messages are a registered-user feature, exactly like friends.
 *
 * `requireFullUser` blocks guests for the same reason it blocks them from the
 * friends graph: a guest token is ephemeral and scoped to one room, so a DM
 * thread addressed to one would outlive the identity that owns it — leaving
 * messages nobody can ever read, attached to a user that no longer exists.
 */
router.use(authenticate, requireFullUser);

router.get("/", listConversations);
router.post("/", validate(openConversationSchema), openConversation);
router.get("/:id/messages", getConversationMessages);
router.post("/:id/read", markConversationRead);
router.post("/:id/attachments", chatUploadFiles, uploadConversationAttachments);
router.delete("/:id", clearConversation); // clear for ME — never for both

export default router;
