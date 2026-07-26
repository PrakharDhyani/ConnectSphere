/**
 * Express app configuration
 *
 * Separating app setup from server startup (index.js) is a best practice:
 *  - Easier to test (import app without starting a server)
 *  - Cleaner separation of concerns
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { logger } from "./utils/logger.js";
import { passport, configurePassport } from "./config/passport.js";

// ── Route imports (we'll build these in upcoming phases) ──
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import roomRoutes from "./routes/room.routes.js";
import friendRoutes from "./routes/friend.routes.js";

// ── Error handler ──
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";

export const app = express();

// ── Security headers (helmet sets ~15 HTTP security headers) ──
app.use(helmet());

// ── CORS — allow requests from the React frontend ──
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,           // allow cookies / auth headers
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// ── Rate limiting — prevent brute force / DDoS ──
// This applies to ALL routes. We'll add stricter limits on auth routes.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 300,                    // 300 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Disabled under test — the in-process limiter counts every supertest
  // request from the same loopback IP, so a suite that fires >max requests
  // would start getting 429s unrelated to what it's asserting.
  skip: () => process.env.NODE_ENV === "test",
});
app.use(globalLimiter);

// ── Body parsing ──
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Cookie parsing — needed to read the httpOnly refresh-token cookie ──
app.use(cookieParser());

// ── Passport (Google OAuth) — stateless, no sessions; JWTs take over
//    after the one callback request ──
configurePassport();
app.use(passport.initialize());

// ── HTTP request logging (morgan → winston) ──
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ── Health check (used by Docker & k8s liveness probes) ──
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "connectsphere-backend",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── API Routes ──
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/friends", friendRoutes);

// ── 404 & error handling (always last) ──
app.use(notFound);
app.use(errorHandler);
