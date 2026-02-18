import nodemailer from "nodemailer";
import { formatDateYmd } from "./time.js";

export function buildEmailText(text) {
  return String(text || "").trim();
}

export async function sendSummaryEmail(config, text) {
  const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  const subjectDate = formatDateYmd(new Date(), config.schedule.timezone);
  const subject = `Schoology Summary - ${subjectDate}`;

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject,
    text: buildEmailText(text),
  });
}
