import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/authenticate.js";
import { requireFullUser } from "../middleware/requireFullUser.js";
import { validate } from "../middleware/validate.js";
import { updateMeSchema } from "../validators/user.validator.js";
import { getMe, updateMe, uploadAvatar } from "../controllers/user.controller.js";
import { allowedAvatarMimeTypes } from "../services/storage.service.js";

const router = Router();

// Avatar uploads: keep the file in memory (we stream it straight to object
// storage — never to local disk), cap at 2MB, images only. The mimetype check
// here is UX-level filtering; storage only maps known image types anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedAvatarMimeTypes.includes(file.mimetype)) return cb(null, true);
    const error = new Error("Only JPEG, PNG, or WebP images are allowed");
    error.statusCode = 400;
    cb(error);
  },
});

// Multer's own errors (e.g. file too large) don't carry a statusCode — wrap
// the middleware so they surface as 400s instead of generic 500s.
function uploadAvatarFile(req, res, next) {
  upload.single("avatar")(req, res, (err) => {
    if (err) {
      err.statusCode = err.statusCode || 400;
      return next(err);
    }
    next();
  });
}

router.get("/me", authenticate, getMe); // guests can read their own identity
router.patch("/me", authenticate, requireFullUser, validate(updateMeSchema), updateMe);
router.post("/me/avatar", authenticate, requireFullUser, uploadAvatarFile, uploadAvatar);

export default router;
