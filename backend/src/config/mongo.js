import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

export async function connectMongo() {
  const uri = process.env.MONGO_URI;

  mongoose.connection.on("connected", () =>
    logger.info("✅ MongoDB connected")
  );
  mongoose.connection.on("error", (err) =>
    logger.error("MongoDB error:", err)
  );
  mongoose.connection.on("disconnected", () =>
    logger.warn("⚠️  MongoDB disconnected")
  );

  await mongoose.connect(uri, {
    // These options prevent deprecation warnings
    serverSelectionTimeoutMS: 5000,
  });
}
