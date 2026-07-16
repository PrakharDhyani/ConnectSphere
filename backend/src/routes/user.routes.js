import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { getMe } from "../controllers/user.controller.js";

const router = Router();

router.get("/me", authenticate, getMe);

export default router;
