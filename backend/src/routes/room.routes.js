import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/authenticate.js";
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
  reportMember,
} from "../controllers/room.controller.js";
import { getRoomMessages, uploadRoomAttachments } from "../controllers/message.controller.js";
import { allowedChatMimeTypes, MAX_CHAT_FILE_BYTES } from "../services/storage.service.js";

const router = Router();

// Chat attachments: buffered in memory and streamed straight to object storage
// (never local disk), 25 MB each, up to 10 per message, whitelisted types only.
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_FILE_BYTES, files: 10 },
  fileFilter: (req, file, cb) => {
    if (allowedChatMimeTypes.includes(file.mimetype)) return cb(null, true);
    const error = new Error(`"${file.mimetype}" files aren't allowed here`);
    error.statusCode = 400;
    cb(error);
  },
});

// Multer's own errors (file too large, too many files) carry no statusCode —
// wrap so they surface as 400s with a readable message instead of 500s.
function chatUploadFiles(req, res, next) {
  chatUpload.array("files", 10)(req, res, (err) => {
    if (err) {
      err.statusCode = err.statusCode || 400;
      if (err.code === "LIMIT_FILE_SIZE") err.message = "That file is too large (max 25 MB)";
      if (err.code === "LIMIT_FILE_COUNT") err.message = "Too many files at once (max 10)";
      return next(err);
    }
    next();
  });
}

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

// Allowed for scoped guests too (access is gated per-room inside the handlers).
router.get("/:id", getRoom);
router.get("/:id/messages", getRoomMessages);
router.post("/:id/attachments", chatUploadFiles, uploadRoomAttachments);
router.post("/:id/leave", leaveRoom);
router.post("/:id/report", reportMember);

export default router;
