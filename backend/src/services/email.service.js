/**
 * Email Service (nodemailer)
 *
 * One transport, configured entirely from env — dev points at the MailDev
 * container (catches mail, no real delivery), prod points at a real SMTP
 * provider (Resend/Brevo/etc.). The rest of the app calls the send* helpers
 * and never touches SMTP details.
 */

import nodemailer from "nodemailer";
import { logger } from "../utils/logger.js";

let transporter;

export function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true", // true only for port 465
      // MailDev needs no auth; only pass credentials if configured.
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

async function send({ to, subject, html }) {
  const info = await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
  logger.info(`📧 Email sent: "${subject}" → ${to} (id: ${info.messageId})`);
  return info;
}

export function sendVerificationEmail(to, verifyUrl) {
  return send({
    to,
    subject: "Verify your ConnectSphere email",
    html: `
      <h2>Welcome to ConnectSphere 🌐</h2>
      <p>Confirm your email address to activate your account:</p>
      <p><a href="${verifyUrl}">Verify my email</a></p>
      <p>This link expires in 24 hours. If you didn't sign up, ignore this email.</p>
    `,
  });
}

export function sendPasswordResetEmail(to, resetUrl) {
  return send({
    to,
    subject: "Reset your ConnectSphere password",
    html: `
      <h2>Password reset</h2>
      <p>We received a request to reset your password. Click below to choose a new one:</p>
      <p><a href="${resetUrl}">Reset my password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore it —
      your password won't change.</p>
    `,
  });
}
