import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validate.js";
import { createRoomSchema, joinRoomSchema } from "../validators/room.validator.js";
import {
  createRoom,
  listMyRooms,
  getRoom,
  joinRoom,
} from "../controllers/room.controller.js";
import { getRoomMessages } from "../controllers/message.controller.js";

const router = Router();

// Every room endpoint requires a logged-in user.
router.use(authenticate);

router.post("/", validate(createRoomSchema), createRoom);
router.get("/", listMyRooms);
router.post("/join", validate(joinRoomSchema), joinRoom);
router.get("/:id", getRoom);
router.get("/:id/messages", getRoomMessages);

export default router;
