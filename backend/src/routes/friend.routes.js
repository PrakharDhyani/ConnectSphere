import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireFullUser } from "../middleware/requireFullUser.js";
import { validate } from "../middleware/validate.js";
import { requestSchema, inviteSchema } from "../validators/friend.validator.js";
import {
  searchUsers,
  sendRequest,
  listFriends,
  listRequests,
  acceptRequest,
  declineRequest,
  removeFriend,
  inviteToRoom,
  blockUser,
  unblockUser,
  listBlocked,
} from "../controllers/friend.controller.js";

const router = Router();

// Friends are a registered-user feature — guests are blocked entirely.
router.use(authenticate, requireFullUser);

router.get("/search", searchUsers);
router.get("/", listFriends);
router.get("/requests", listRequests);
router.post("/request", validate(requestSchema), sendRequest);
router.post("/requests/:id/accept", acceptRequest);
router.delete("/requests/:id", declineRequest); // decline incoming / cancel outgoing
router.post("/invite", validate(inviteSchema), inviteToRoom);
router.get("/blocked", listBlocked);

// Block routes come BEFORE `/:userId`, or Express would match "blocked" as a
// userId and every block listing would 404 on an invalid ObjectId.
router.post("/:userId/block", blockUser);
router.delete("/:userId/block", unblockUser);

router.delete("/:userId", removeFriend); // unfriend

export default router;
