/**
 * Winston Logger — Structured Logging
 *
 * What is structured logging?
 *   Instead of console.log("user joined"), we log JSON:
 *   { "level": "info", "message": "user joined", "timestamp": "...", "userId": "..." }
 *
 * Why does it matter in production?
 *   JSON logs can be ingested by tools like:
 *   - Grafana Loki     → search & visualize logs
 *   - AWS CloudWatch   → cloud log aggregation
 *   - Datadog          → alerting on error rates
 *
 * Log levels (least → most severe):
 *   http < debug < info < warn < error
 */

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Custom format for console output (human-readable in dev)
const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Rotate log files daily, keep 14 days, zip old files
const fileRotateTransport = new DailyRotateFile({
  filename: "logs/connectsphere-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxFiles: "14d",
  zippedArchive: true,
  level: "info",
  format: combine(timestamp(), errors({ stack: true }), json()),
});

// Separate file for errors only (easier to scan in production)
const errorFileTransport = new DailyRotateFile({
  filename: "logs/error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxFiles: "30d",
  zippedArchive: true,
  level: "error",
  format: combine(timestamp(), errors({ stack: true }), json()),
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: combine(errors({ stack: true }), timestamp()),
  transports: [
    // Console transport — pretty in dev, JSON in prod
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === "production"
          ? combine(timestamp(), json())
          : combine(colorize(), timestamp({ format: "HH:mm:ss" }), devFormat),
    }),
    fileRotateTransport,
    errorFileTransport,
  ],
});
