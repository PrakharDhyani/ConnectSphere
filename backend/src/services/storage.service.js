/**
 * Object storage (S3-compatible) — avatars now, recordings later.
 *
 * We code against the official AWS S3 SDK but point it at self-hosted MinIO
 * in dev (free-tier rule: no paid cloud). Because MinIO speaks S3's exact
 * protocol, switching to real S3/Cloudflare R2 in prod is an env-var change,
 * zero code.
 *
 * Same graceful-degradation pattern as Google OAuth: if S3_* env vars aren't
 * set, uploads return a clear 501 instead of crashing — dev stays bootable
 * without MinIO running.
 */
import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { logger } from "../utils/logger.js";

export const storageEnabled = () =>
  Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);

let client;
let bucketReady = false;

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT, // e.g. http://localhost:9000 (MinIO)
      region: process.env.S3_REGION || "us-east-1", // SDK requires one; MinIO ignores it
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
      // MinIO serves buckets as a path (host/bucket/key), not a subdomain
      // (bucket.host/key) like AWS — without this, requests 404.
      forcePathStyle: true,
      // Since ~Jan 2025 the AWS SDK v3 adds a default crc32 integrity checksum
      // to every upload, streamed via `aws-chunked` encoding. S3-compatible
      // stores like MinIO stall on that framing, so PutObject hangs forever.
      // "WHEN_REQUIRED" restores the pre-2025 behaviour (checksum only when the
      // operation actually mandates one) — real AWS S3 also accepts this.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      // Never let a storage hiccup hang a user's request forever — fail fast so
      // the controller can surface a real error instead of a dead connection.
      requestHandler: { connectionTimeout: 4000, requestTimeout: 10000 },
    });
  }
  return client;
}

const bucketName = () => process.env.S3_BUCKET || "connectsphere";

// Create the bucket on first use if it doesn't exist (idempotent, dev-friendly)
// and make the avatars/ prefix publicly readable so the browser can load them.
async function ensureBucket() {
  if (bucketReady) return;
  const Bucket = bucketName();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket }));
  } catch {
    await getClient().send(new CreateBucketCommand({ Bucket }));
    logger.info(`🪣 Created storage bucket "${Bucket}"`);
  }

  // MinIO buckets are private by default, so an <img src> to an avatar URL
  // would get 403. Allow anonymous read, scoped ONLY to the prefixes the
  // browser must load directly (avatars, chat attachments) — nothing else in
  // the bucket (future recordings, etc.) is exposed. Best-effort: a policy
  // hiccup shouldn't block the upload itself.
  //
  // NOTE on chat/: attachment keys embed a random uuid, so the URL is
  // unguessable — "public but unlisted", the same trade-off Slack's own file
  // links make. Signed URLs would be stricter but expire, which breaks the
  // durable chat history that is the whole point of storing them.
  try {
    await getClient().send(
      new PutBucketPolicyCommand({
        Bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { AWS: ["*"] },
              Action: ["s3:GetObject"],
              Resource: [
                `arn:aws:s3:::${Bucket}/avatars/*`,
                `arn:aws:s3:::${Bucket}/chat/*`,
              ],
            },
          ],
        }),
      })
    );
  } catch (err) {
    logger.warn(`Could not set public read policy: ${err.message}`);
  }

  bucketReady = true;
}

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const allowedAvatarMimeTypes = Object.keys(EXT_BY_MIME);

/**
 * Upload a user's avatar. Key is deterministic (avatars/<userId>.<ext>) so a
 * re-upload overwrites the old file — no orphan cleanup needed. The returned
 * URL carries a version query so browsers don't keep showing a cached old
 * avatar at the same URL.
 */
export async function uploadAvatar(userId, buffer, mimetype) {
  await ensureBucket();
  const key = `avatars/${userId}.${EXT_BY_MIME[mimetype]}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  );

  const publicBase = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT;
  return `${publicBase}/${bucketName()}/${key}?v=${Date.now()}`;
}

// ── Chat attachments ───────────────────────────────────────────────────────

/**
 * What a chat attachment may be. Deliberately a WHITELIST: anything not listed
 * is rejected rather than stored-and-hoped-for. Executables, archives and
 * scripts are absent on purpose — a hangout platform has no reason to relay
 * them, and "user uploaded a .exe that another user downloads" is the classic
 * way a chat feature turns into a malware vector.
 */
const CHAT_MIME_KIND = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
  "image/heic": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "audio/webm": "audio",
  "application/pdf": "file",
  "text/plain": "file",
  "text/csv": "file",
  "text/markdown": "file",
  "application/json": "file",
  "application/zip": "file",
  "application/msword": "file",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "file",
  "application/vnd.ms-excel": "file",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "file",
  "application/vnd.ms-powerpoint": "file",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "file",
};

export const allowedChatMimeTypes = Object.keys(CHAT_MIME_KIND);
export const chatKindFor = (mime) => CHAT_MIME_KIND[mime] || null;
export const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — generous for a hangout, cheap for MinIO

// Keep the extension for nicer downloads, but never trust the user's filename
// in the KEY itself — a crafted name is a path-traversal / content-type trick
// waiting to happen. uuid + sanitized extension only.
function safeExtension(filename = "", mime = "") {
  const fromName = /\.([a-zA-Z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase();
  if (fromName) return `.${fromName}`;
  const fromMime = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return fromMime ? `.${fromMime}` : "";
}

/**
 * Upload one chat attachment. Key = chat/<roomId>/<uuid><ext> — random, so the
 * public-read prefix stays effectively unlisted, and scoped by room so a
 * future "delete room ⇒ delete its files" sweep is a single prefix delete.
 *
 * `ContentDisposition: attachment` on non-media types is the important bit:
 * without it a text/html-ish upload served from our own origin could execute
 * in the user's session. Media (image/video/audio) stays inline so it can
 * render in the chat bubble.
 */
export async function uploadChatAttachment(roomId, { buffer, mimetype, originalname }) {
  await ensureBucket();
  const kind = chatKindFor(mimetype);
  if (!kind) {
    const error = new Error("That file type isn't allowed");
    error.statusCode = 400;
    throw error;
  }

  const { randomUUID } = await import("node:crypto");
  const key = `chat/${roomId}/${randomUUID()}${safeExtension(originalname, mimetype)}`;
  const inline = kind === "image" || kind === "video" || kind === "audio";
  // Strip quotes/newlines — this string goes into an HTTP header.
  const downloadName = (originalname || "file").replace(/["\r\n]/g, "").slice(0, 200);

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: buffer,
      ContentType: mimetype,
      ContentDisposition: inline
        ? `inline; filename="${downloadName}"`
        : `attachment; filename="${downloadName}"`,
    })
  );

  const publicBase = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT;
  return {
    kind,
    url: `${publicBase}/${bucketName()}/${key}`,
    name: downloadName,
    mime: mimetype,
    size: buffer.length,
  };
}
