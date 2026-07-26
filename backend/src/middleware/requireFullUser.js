// Blocks ephemeral guests from actions reserved for registered accounts:
// creating rooms, editing a profile, listing the dashboard, etc. Runs AFTER
// `authenticate` (so req.user exists).
export function requireFullUser(req, res, next) {
  if (req.user?.isGuest) {
    const error = new Error("Guests can't do this — create a free account to continue");
    error.statusCode = 403;
    return next(error);
  }
  next();
}
