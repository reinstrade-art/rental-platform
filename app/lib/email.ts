import "server-only";
import nodemailer from "nodemailer";

/**
 * Gmail SMTP via an App Password (not the account's real password — Gmail
 * requires 2-Step Verification to generate one, and rejects a plain
 * password from a script outright). Both env vars are optional — when
 * either is unset, sendEmail() is a no-op that resolves false, so every
 * call site (invites, tier-request confirmations) degrades to "nothing
 * sent" rather than throwing when this hasn't been configured yet.
 *
 * The transport is built once per server instance and reused — Gmail rate
 * limits new SMTP connections more aggressively than the send itself.
 */
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  }
  return transporter;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  attachments?: { filename: string; content: Buffer; contentType?: string }[],
): Promise<boolean> {
  const t = getTransporter();
  const user = process.env.GMAIL_USER;
  if (!t || !user) return false;

  try {
    await t.sendMail({ from: user, to, subject, text, attachments });
    return true;
  } catch (e) {
    console.error("sendEmail error", e);
    return false;
  }
}
