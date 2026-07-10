import { Router } from "express";
const router = Router();
router.get("/", (req, res) => res.json({ message: "User routes — coming in Phase 2" }));
export default router;

