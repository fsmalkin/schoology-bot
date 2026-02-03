import twilio from "twilio";
import { formatDateTime, formatDateYmd } from "./time.js";

function simplifyCourseName(name) {
  const raw = String(name || "").replace(/\s+/g, " ").trim();
  if (!raw) return "Other";
  const base = raw.split(":")[0].trim();
  return base.replace(/Course$/i, "").trim();
}

function lineForAssignment(a) {
  const parts = [];
  if (a.course) parts.push(simplifyCourseName(a.course));
  if (a.title) parts.push(a.title);
  if (a.dueDate) parts.push(`Due: ${a.dueDate}`);
  if (a.status) parts.push(`Status: ${a.status}`);
  return `- ${parts.join(" | ")}`;
}

function addLine(lines, line, limit) {
  const current = lines.join("\n");
  const nextLength = current.length + (current.length > 0 ? 1 : 0) + line.length;
  if (nextLength > limit) return false;
  lines.push(line);
  return true;
}

export function buildSmsText(summary, state, timeZone) {
  const lines = [];
  const today = formatDateYmd(new Date(), timeZone);

  lines.push(`Schoology missing summary ${today}`);
  if (state.lastScrapeAt) {
    lines.push(`Last scrape: ${formatDateTime(new Date(state.lastScrapeAt), timeZone)} ${timeZone}`);
  }

  if (summary.currentMissing.length === 0) {
    lines.push("No missing assignments.");
    return lines.join("\n");
  }

  const limit = 1400;
  let remaining = 0;

  addLine(lines, `Missing assignments (${summary.currentMissing.length}):`, limit);
  for (const item of summary.currentMissing) {
    if (!addLine(lines, lineForAssignment(item), limit)) {
      remaining += 1;
    }
  }

  if (remaining > 0) {
    addLine(lines, `... and ${remaining} more`, limit);
  }

  return lines.join("\n");
}

export async function sendSummarySms(config, summary, state) {
  const client = twilio(config.twilio.accountSid, config.twilio.authToken);
  const text = buildSmsText(summary, state, config.schedule.timezone);

  const basePayload = {
    body: text,
  };

  if (config.twilio.messagingServiceSid) {
    basePayload.messagingServiceSid = config.twilio.messagingServiceSid;
  } else {
    basePayload.from = config.twilio.from;
  }

  const results = [];
  for (const to of config.twilio.to) {
    const message = await client.messages.create({
      ...basePayload,
      to,
    });
    results.push(message.sid);
  }

  return results;
}
