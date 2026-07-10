import { Router } from "express";
const router = Router();
router.get("/", (req, res) => res.json({ message: "Room routes — coming in Phase 3" }));
export default router;
