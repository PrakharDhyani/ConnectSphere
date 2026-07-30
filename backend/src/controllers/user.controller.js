import { User } from "../models/User.js";
import {
  storageEnabled,
  uploadAvatar as uploadAvatarToStorage,
} from "../services/storage.service.js";

// One whitelist for every response shape in this controller — never the hash.
function toSafeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    isGuest: Boolean(user.isGuest),
  };
}

export async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    res.json({ success: true, data: { user: toSafeUser(user) } });
  } catch (error) {
    next(error);
  }
}

// PATCH /users/me — body already validated + stripped by updateMeSchema, so
// spreading it is safe (only whitelisted fields can be present).
export async function updateMe(req, res, next) {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: req.body },
      { new: true, runValidators: true } // return the updated doc, re-check schema rules
    );
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    res.json({ success: true, data: { user: toSafeUser(user) } });
  } catch (error) {
    next(error);
  }
}

// POST /users/me/avatar — multipart upload (multer put the file in req.file).
export async function uploadAvatar(req, res, next) {
  try {
    if (!storageEnabled()) {
      const error = new Error("File storage is not configured");
      error.statusCode = 501;
      throw error;
    }

    if (!req.file) {
      const error = new Error("No image file provided (field name: avatar)");
      error.statusCode = 400;
      throw error;
    }

    const avatarUrl = await uploadAvatarToStorage(
      req.user.id,
      req.file.buffer,
      req.file.mimetype
    );

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatarUrl },
      { new: true }
    );
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    res.json({ success: true, data: { user: toSafeUser(user) } });
  } catch (error) {
    next(error);
  }
}
