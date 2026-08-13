/**
 * Web Push sender (VAPID).
 *
 * Web Push is free and serverless-friendly: the browser vendors run the push
 * relays (FCM for Chrome, Mozilla's autopush, …) and VAPID keys are just a
 * locally generated keypair — no account with anyone. Generate once with:
 *   npx web-push generate-vapid-keys
 * and put the pair in backend/.env. Same graceful-degradation convention as
 * storage/oauth: keys absent → push silently off, everything else still works.
 */
import webpush from "web-push";
import { PushSubscription } from "../models/PushSubscription.js";
import { logger } from "../utils/logger.js";

let configuredFlag = null;

export function pushConfigured() {
  if (configuredFlag === null) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    configuredFlag = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
    if (configuredFlag) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || `mailto:no-reply@connectsphere.local`,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
      );
    }
  }
  return configuredFlag;
}

export const vapidPublicKey = () => (pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null);

/**
 * Fire a notification at every subscription of every listed user.
 * Fire-and-forget by design — callers must never block a socket event or an
 * HTTP response on push delivery. Expired subscriptions (410/404) are pruned.
 *
 * payload: { title, body?, url?, tag? } — interpreted by frontend/public/sw.js
 */
export async function sendPushToUsers(userIds, payload) {
  if (!pushConfigured() || !userIds?.length) return;
  try {
    const subs = await PushSubscription.find({ user: { $in: userIds } }).lean();
    const body = JSON.stringify(payload);
    await Promise.allSettled(
      subs.map((s) =>
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 300 })
          .catch(async (err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
            } else {
              logger.warn(`web-push failed (${err.statusCode || err.message})`);
            }
          })
      )
    );
  } catch (err) {
    logger.error("sendPushToUsers failed:", err);
  }
}
