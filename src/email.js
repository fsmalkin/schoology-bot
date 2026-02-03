import nodemailer from "nodemailer";
import { formatDateTime, formatDateYmd } from "./time.js";

function simplifyCourseName(name) {
  const raw = String(name || "").replace(/\s+/g, " ").trim();
  if (!raw) return "Other";
  const base = raw.split(":")[0].trim();
  return base.replace(/Course$/i, "").trim();
}

function lineForAssignment(a) {
  const parts = [];
  if (a.course) parts.push(`Course: ${simplifyCourseName(a.course)}`);
  if (a.title) parts.push(`Title: ${a.title}`);
  if (a.dueDate) parts.push(`Due: ${a.dueDate}`);
  if (a.score) parts.push(`Score: ${a.score}`);
  if (a.status) parts.push(`Status: ${a.status}`);
  if (a.url) parts.push(`Link: ${a.url}`);
  return `- ${parts.join(" | ")}`;
}

function section(title, items) {
  if (!items || items.length === 0) return [];
  return [title, ...items.map(lineForAssignment), ""];
}

export function buildEmailText(summary, state, timeZone) {
  const lines = [];
  const today = formatDateYmd(new Date(), timeZone);

  lines.push(`Missing assignments summary for ${today}.`);
  if (state.lastScrapeAt) {
    lines.push(`Last scrape: ${formatDateTime(new Date(state.lastScrapeAt), timeZone)} ${timeZone}`);
  }
  lines.push("");

  if (summary.currentMissing.length === 0) {
    lines.push("No missing assignments found.");
    return lines.join("\n");
  }

  lines.push(...section(`Missing assignments (${summary.currentMissing.length}):`, summary.currentMissing));

  return lines.join("\n").trim();
}

export async function sendSummaryEmail(config, summary, state) {
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
  const subject = `Schoology Missing Assignments - ${subjectDate}`;
  const text = buildEmailText(summary, state, config.schedule.timezone);

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject,
    text,
  });
}
