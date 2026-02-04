import OpenAI from "openai";
import { validateOpenAIConfig } from "./config.js";
import { formatDateTime, formatDateYmd } from "./time.js";
import { renderTelegramHtml } from "./telegram_format.js";
import { normalizeAscii } from "./text_utils.js";

function extractText(response) {
  if (response?.output_text) return response.output_text;
  const output = response?.output;
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      if (!item) return "";
      if (item.type === "output_text" && item.text) return item.text;
      if (item.type === "message" && Array.isArray(item.content)) {
        return item.content.map((part) => (part?.text ? part.text : "")).join("");
      }
      return "";
    })
    .join("");
}

function buildInstructions() {
  return [
    "You are generating a daily Schoology summary for Telegram.",
    "Return plain text only. Do not use HTML tags.",
    "Use simple Markdown-style structure: section headers as plain lines, bullets with '-', numbered lists with '1.'.",
    "Include these sections in order if they have items:",
    "1) Missing assignments (Actionable)",
    "2) Missing but waiting on teacher/grade (Pending)",
    "3) Reminders (Today, Overdue, Upcoming) if provided",
    "For each assignment include: course, title, due date if present, and status.",
    "If notes are present, show them under the assignment as short bullet lines.",
    "If a URL is provided, put it on its own line after the item.",
    "Keep it concise.",
  ].join(" ");
}

export async function buildAgenticTelegramSummary({ config, summary, state, reminders }) {
  validateOpenAIConfig();
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const today = formatDateYmd(new Date(), config.schedule.timezone);

  const payload = {
    date: today,
    timezone: config.schedule.timezone,
    lastScrapeAt: state.lastScrapeAt || null,
    actionable: summary.actionable || [],
    pending: summary.pending || [],
    reminders: reminders || {},
  };

  const response = await client.responses.create({
    model: config.openai.model,
    reasoning: { effort: config.openai.reasoningEffort },
    max_output_tokens: config.openai.maxOutputTokens,
    instructions: buildInstructions(),
    input: JSON.stringify(payload),
    tool_choice: "none",
    parallel_tool_calls: false,
  });

  const raw = extractText(response).trim();
  if (!raw) {
    return renderTelegramHtml(`Schoology missing summary ${today}`);
  }

  const header = [`<b>Schoology missing summary</b> ${today}`];
  if (state.lastScrapeAt) {
    header.push(
      `<i>Last scrape:</i> ${formatDateTime(
        new Date(state.lastScrapeAt),
        config.schedule.timezone
      )} ${config.schedule.timezone}`
    );
  }
  const combined = `${header.join("\n")}\n\n${normalizeAscii(raw)}`;
  return renderTelegramHtml(combined);
}
