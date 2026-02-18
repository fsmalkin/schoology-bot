import TelegramBot from "node-telegram-bot-api";
import { renderTelegramHtml, renderTelegramPlain } from "./telegram_format.js";

function trimToLimit(text, limit) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const out = [];
  for (const line of lines) {
    const candidate = out.length === 0 ? line : `${out.join("\n")}\n${line}`;
    if (candidate.length > limit) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function buildTelegramText(text, limit = 3500) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  return trimToLimit(normalized, limit);
}

export async function sendSummaryTelegram(config, text) {
  return await sendTelegramMessage(config, buildTelegramText(text));
}

export async function sendTelegramMessage(config, text) {
  const bot = new TelegramBot(config.telegram.botToken, { polling: false });
  const formatted = renderTelegramHtml(text);
  const plain = renderTelegramPlain(text);

  const results = [];
  for (const chatId of config.telegram.chatIds) {
    try {
      const message = await bot.sendMessage(chatId, formatted, {
        disable_web_page_preview: true,
        parse_mode: "HTML",
      });
      results.push(message.message_id);
    } catch (err) {
      const message = await bot.sendMessage(chatId, plain, {
        disable_web_page_preview: true,
      });
      results.push(message.message_id);
    }
  }

  return results;
}
