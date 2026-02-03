import TelegramBot from "node-telegram-bot-api";
import { formatDateTime, formatDateYmd } from "./time.js";

function simplifyCourseName(name) {
  const raw = String(name || "").replace(/\s+/g, " ").trim();
  if (!raw) return "Other";
  const base = raw.split(":")[0].trim();
  return base.replace(/Course$/i, "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addLine(lines, line, limit) {
  const current = lines.join("\n");
  const nextLength = current.length + (current.length > 0 ? 1 : 0) + line.length;
  if (nextLength > limit) return false;
  lines.push(line);
  return true;
}

export function buildTelegramText(summary, state, timeZone) {
  const lines = [];
  const today = formatDateYmd(new Date(), timeZone);

  lines.push(`<b>Schoology missing summary</b> ${today}`);
  if (state.lastScrapeAt) {
    lines.push(
      `<i>Last scrape:</i> ${formatDateTime(new Date(state.lastScrapeAt), timeZone)} ${timeZone}`
    );
  }

  if (summary.currentMissing.length === 0) {
    lines.push("No missing assignments.");
    return lines.join("\n");
  }

  const limit = 3500;
  let remaining = 0;

  addLine(lines, `<b>Missing assignments (${summary.currentMissing.length})</b>`, limit);

  const grouped = new Map();
  for (const item of summary.currentMissing) {
    const course = simplifyCourseName(item.course);
    if (!grouped.has(course)) grouped.set(course, []);
    grouped.get(course).push(item);
  }

  const courses = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  let courseIndex = 1;

  for (const course of courses) {
    const items = grouped.get(course) || [];
    if (!addLine(lines, `${courseIndex}. <b>${escapeHtml(course)}</b> (${items.length})`, limit)) {
      remaining += items.length;
      break;
    }

    for (const item of items) {
      const parts = [];
      if (item.title) parts.push(escapeHtml(item.title));
      if (item.dueDate) parts.push(`Due ${escapeHtml(item.dueDate)}`);
      if (item.status) parts.push(`Status: ${escapeHtml(item.status)}`);
      const line = `  - ${parts.join(" - ")}`;
      if (!addLine(lines, line, limit)) {
        remaining += 1;
      }
    }

    courseIndex += 1;
  }

  if (remaining > 0) {
    addLine(lines, `... and ${remaining} more`, limit);
  }

  return lines.join("\n");
}

export async function sendSummaryTelegram(config, summary, state) {
  const text = buildTelegramText(summary, state, config.schedule.timezone);
  return await sendTelegramMessage(config, text);
}

export async function sendTelegramMessage(config, text) {
  const bot = new TelegramBot(config.telegram.botToken, { polling: false });

  const results = [];
  for (const chatId of config.telegram.chatIds) {
    const message = await bot.sendMessage(chatId, text, {
      disable_web_page_preview: true,
      parse_mode: "HTML",
    });
    results.push(message.message_id);
  }

  return results;
}
