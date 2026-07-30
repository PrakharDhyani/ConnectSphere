import { Router } from "express";
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
} from "../controllers/room.controller.js";
import { getRoomMessages } from "../controllers/message.controller.js";

const router = Router();

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

// Allowed for scoped guests too (access is gated per-room inside the handlers).
router.get("/:id", getRoom);
router.get("/:id/messages", getRoomMessages);
router.post("/:id/leave", leaveRoom);

export default router;
