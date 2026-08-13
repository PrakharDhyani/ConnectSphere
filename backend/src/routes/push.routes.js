/**
 * Web Push subscription management.
 *
 *   GET    /api/push/key        → { publicKey }  (null when VAPID isn't configured)
 *   POST   /api/push/subscribe  { subscription } → upsert this browser's subscription
 *   DELETE /api/push/subscribe  { endpoint }     → forget this browser
 *
 * Full users only — a guest's identity dies with their token, so a push
 * subscription tied to it could never be addressed again.
 */
import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireFullUser } from "../middleware/requireFullUser.js";
import { PushSubscription } from "../models/PushSubscription.js";
import { vapidPublicKey } from "../services/push.service.js";

const router = Router();

router.use(authenticate, requireFullUser);

router.get("/key", (req, res) => {
  res.json({ success: true, data: { publicKey: vapidPublicKey() } });
});

router.post("/subscribe", async (req, res, next) => {
  try {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ success: false, error: { message: "Invalid subscription" } });
    }
    // Endpoint is the key: a browser re-subscribing (or a second account on the
    // same browser) takes the row over instead of creating a duplicate.
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        user: req.user.id,
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
      },
      { upsert: true, new: true }
    );
    res.status(201).json({ success: true, message: "Subscribed" });
  } catch (error) {
    next(error);
  }
});

router.delete("/subscribe", async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user.id });
    res.json({ success: true, message: "Unsubscribed" });
  } catch (error) {
    next(error);
  }
});

export default router;
