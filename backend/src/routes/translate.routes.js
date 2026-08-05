/**
 * Caption translation proxy → LibreTranslate.
 *
 * LibreTranslate is a free, self-hosted MT server (docker-compose service
 * `libretranslate`, ~1 GB with models). Proxying through the backend keeps the
 * browser same-origin (no CORS story) and keeps the instance URL server-side.
 * Same graceful degradation as push/S3: env var absent → 501, captions simply
 * stay untranslated.
 *
 *   POST /api/translate { q, source?, target } → { translatedText }
 *
 * Guests can translate too (they sit in calls like anyone else), so this is
 * behind `authenticate` only, not `requireFullUser`.
 */
import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

router.post("/", authenticate, async (req, res, next) => {
  try {
    const base = process.env.LIBRETRANSLATE_URL;
    if (!base) {
      return res.status(501).json({ success: false, error: { message: "Translation is not configured" } });
    }
    const q = String(req.body?.q || "").slice(0, 1000);
    const source = String(req.body?.source || "auto").slice(0, 8);
    const target = String(req.body?.target || "").slice(0, 8);
    if (!q.trim() || !target) {
      return res.status(400).json({ success: false, error: { message: "q and target are required" } });
    }

    const r = await fetch(`${base.replace(/\/$/, "")}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, source, target, format: "text", api_key: process.env.LIBRETRANSLATE_API_KEY || "" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return res.status(502).json({ success: false, error: { message: "Translation service error" } });
    }
    const data = await r.json();
    res.json({ success: true, data: { translatedText: data.translatedText || "" } });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ success: false, error: { message: "Translation timed out" } });
    }
    next(error);
  }
});

export default router;
