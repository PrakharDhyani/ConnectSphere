import { logger } from "../utils/logger.js";

/**
 * Global Error Handler Middleware
 *
 * Express calls this when any route throws an error or calls next(error).
 * It must have 4 parameters — (err, req, res, next) — for Express to
 * recognize it as an error handler.
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    statusCode,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message:
        process.env.NODE_ENV === "production" && statusCode === 500
          ? "Internal server error"  // hide stack traces in prod
          : err.message,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    },
  });
}
