import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { listActivities, recommendActivities } from "../controllers/activity.controller.js";

const router = Router();

// Authenticated: the catalogue is not secret, but there is no reason to serve
// it to anonymous traffic, and recommendations will become personalised.
router.use(authenticate);

router.get("/", listActivities);
router.post("/recommend", recommendActivities);

export default router;
