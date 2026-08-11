import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { chatUploadFiles } from "../middleware/chatUpload.js";
import { requireFullUser } from "../middleware/requireFullUser.js";
import { validate } from "../middleware/validate.js";
import {
  createRoomSchema,
  joinRoomSchema,
  renameRoomSchema,
} from "../validators/room.validator.js";
import {
  createRoom,
  listMyRooms,
  listPublicRooms,
  getRoom,
  joinRoom,
  joinPublicRoom,
  renameRoom,
  leaveRoom,
  deleteRoom,
  kickMember,
  banMember,
  unbanMember,
  setSlowMode,
  setRoomRules,
  setRoomActivities,
  setActiveActivity,
  reportMember,
} from "../controllers/room.controller.js";
import {
  getRoomMessages,
  uploadRoomAttachments,
  viewOnceAttachment,
} from "../controllers/message.controller.js";

const router = Router();

// Chat attachment upload middleware now lives in middleware/chatUpload.js so
// rooms and DMs share ONE definition of the size cap, file count and MIME
// whitelist — those limits are the security control, so a second copy that
// could drift was not acceptable.

// Every room endpoint requires a logged-in user.
router.use(authenticate);

// Registered-user-only actions (guests get 403 via requireFullUser).
router.post("/", requireFullUser, validate(createRoomSchema), createRoom);
router.get("/", requireFullUser, listMyRooms);
router.post("/join", requireFullUser, validate(joinRoomSchema), joinRoom);
// NOTE: "/public" must be declared before "/:id" or Express matches it as an id.
router.get("/public", requireFullUser, listPublicRooms);
router.post("/:id/join-public", requireFullUser, joinPublicRoom);
router.patch("/:id", requireFullUser, validate(renameRoomSchema), renameRoom);
router.delete("/:id", requireFullUser, deleteRoom);

// Moderation — owner-only checks live in the controller.
router.post("/:id/kick", requireFullUser, kickMember);
router.post("/:id/ban", requireFullUser, banMember);
router.post("/:id/unban", requireFullUser, unbanMember);
router.post("/:id/slowmode", requireFullUser, setSlowMode);
router.put("/:id/rules", requireFullUser, setRoomRules);
// Which activities a room has is an owner decision (checked in the controller).
router.put("/:id/activities", requireFullUser, setRoomActivities);

// Allowed for scoped guests too (access is gated per-room inside the handlers).
router.get("/:id", getRoom);
// Switching the open activity is ordinary participation, not administration —
// a scoped guest who joined by link may start a game like anyone else. Access
// is re-checked per-room inside the handler.
router.put("/:id/activities/active", setActiveActivity);
router.get("/:id/messages", getRoomMessages);
router.post("/:id/attachments", chatUploadFiles, uploadRoomAttachments);
router.post("/:id/messages/:messageId/view", viewOnceAttachment);
router.post("/:id/leave", leaveRoom);
router.post("/:id/report", reportMember);

export default router;
