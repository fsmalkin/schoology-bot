import OpenAI from "openai";
import { buildReadableDailySummary } from "./readable_messages.js";
import { formatDateYmd } from "./time.js";
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
    "You are generating optional add-on notes for a Schoology daily summary.",
    "Return plain text only. Do not use HTML tags.",
    "Write at most three short bullets and avoid repeating list items already shown in the summary.",
    "Focus on helpful next steps, follow-ups, or timing suggestions.",
    "If there are no useful add-on notes, return an empty string.",
    "Keep language simple and concise.",
  ].join(" ");
}

function normalizeOptionalNotes(raw) {
  const lines = normalizeAscii(String(raw || ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const bullets = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
    if (!cleaned) continue;
    bullets.push(`- ${cleaned}`);
    if (bullets.length >= 3) break;
  }
  if (bullets.length === 0) return "";
  return ["Quick Notes", ...bullets].join("\n");
}

export async function buildOptionalSummaryNotes({ config, summary, state, reminders }) {
  if (!config?.openai?.apiKey) return "";
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const today = formatDateYmd(new Date(), config.schedule.timezone);

  const payload = {
    date: today,
    timezone: config.schedule.timezone,
    lastScrapeAt: state?.lastScrapeAt || null,
    actionable: summary?.actionable || [],
    pending: summary?.pending || [],
    reminders: reminders || {},
  };

  try {
    const response = await client.responses.create({
      model: config.openai.model,
      reasoning: { effort: config.openai.reasoningEffort },
      max_output_tokens: Math.min(Number(config.openai.maxOutputTokens || 2000), 400),
      instructions: buildInstructions(),
      input: JSON.stringify(payload),
      tool_choice: "none",
      parallel_tool_calls: false,
    });

    return normalizeOptionalNotes(extractText(response).trim());
  } catch (err) {
    return "";
  }
}

export async function buildAgenticTelegramSummary({ config, summary, state, reminders }) {
  const core = buildReadableDailySummary({
    summary,
    reminders,
    state,
    timeZone: config.schedule.timezone,
    now: new Date(),
  });
  const notes = await buildOptionalSummaryNotes({ config, summary, state, reminders });
  if (!notes) return core;
  return normalizeAscii(`${core}\n\n${notes}`);
}
