import multer from "multer";
import { allowedChatMimeTypes, MAX_CHAT_FILE_BYTES } from "../services/storage.service.js";

/**
 * Chat attachment upload middleware, shared by rooms and DMs.
 *
 * Extracted from `room.routes.js` when direct messages landed. The alternative
 * — a second multer instance in `conversation.routes.js` — would have meant two
 * copies of the size cap, the file count and the MIME whitelist, and the first
 * time one was tightened for a security reason the other would have been missed.
 * The limits ARE the security control here, so they get exactly one definition.
 *
 * Files are buffered in memory and streamed straight to object storage (never
 * local disk): 25 MB each, up to 10 per message, whitelisted types only.
 */
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_FILE_BYTES, files: 10 },
  fileFilter: (req, file, cb) => {
    if (allowedChatMimeTypes.includes(file.mimetype)) return cb(null, true);
    const error = new Error(`"${file.mimetype}" files aren't allowed here`);
    error.statusCode = 400;
    cb(error);
  },
});

/**
 * Multer's own errors (file too large, too many files) carry no statusCode —
 * wrap so they surface as 400s with a readable message instead of 500s.
 */
export function chatUploadFiles(req, res, next) {
  chatUpload.array("files", 10)(req, res, (err) => {
    if (err) {
      err.statusCode = err.statusCode || 400;
      if (err.code === "LIMIT_FILE_SIZE") err.message = "That file is too large (max 25 MB)";
      if (err.code === "LIMIT_FILE_COUNT") err.message = "Too many files at once (max 10)";
      return next(err);
    }
    next();
  });
}
