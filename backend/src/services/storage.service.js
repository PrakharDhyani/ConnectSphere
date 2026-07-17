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
    });
  }
  return client;
}

const bucketName = () => process.env.S3_BUCKET || "connectsphere";

// Create the bucket on first use if it doesn't exist (idempotent, dev-friendly).
async function ensureBucket() {
  if (bucketReady) return;
  const Bucket = bucketName();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket }));
  } catch {
    await getClient().send(new CreateBucketCommand({ Bucket }));
    logger.info(`🪣 Created storage bucket "${Bucket}"`);
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
