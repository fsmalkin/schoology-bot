import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { getConfig, validateOpenAIConfig, validateTelegramConfig } from "./config.js";
import { runAgentMessage } from "./agent.js";
import { renderTelegramHtml } from "./telegram_format.js";

const config = getConfig();
validateTelegramConfig();
validateOpenAIConfig();

const allowedChats = new Set((config.telegram.chatIds || []).map((id) => String(id)));
const bot = new TelegramBot(config.telegram.botToken, { polling: true });
const logPath =
  process.env.AGENT_LOG_PATH && process.env.AGENT_LOG_PATH.trim().length > 0
    ? process.env.AGENT_LOG_PATH.trim()
    : path.join(config.paths.dataDir, "agent.log");

function appendLog(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.log(entry);
  if (!logPath) return;
  try {
    const dir = path.dirname(logPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(logPath, `${entry}\n`, "utf8");
  } catch (err) {
    console.warn("Failed to write agent log:", err?.message || err);
  }
}

appendLog("Telegram agent started.");

const MAX_BACKOFF_MS = 60000;
let restartAttempts = 0;
let restartTimer = null;

function formatError(err) {
  if (!err) return "Unknown error";
  return err.response?.body || err.message || String(err);
}

function schedulePollingRestart(err) {
  if (restartTimer) return;
  const delay = Math.min(1000 * Math.pow(2, restartAttempts), MAX_BACKOFF_MS);
  restartAttempts += 1;
  appendLog(`Polling error: ${formatError(err)}. Restarting in ${Math.round(delay / 1000)}s.`);

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      appendLog("Restarting Telegram polling...");
      await bot.stopPolling();
      await bot.startPolling();
      restartAttempts = 0;
      appendLog("Telegram polling restarted.");
    } catch (restartErr) {
      appendLog(`Polling restart failed: ${formatError(restartErr)}`);
      schedulePollingRestart(restartErr);
    }
  }, delay);
}

bot.on("polling_error", (err) => {
  schedulePollingRestart(err);
});

bot.on("message", async (msg) => {
  if (!msg || !msg.chat) return;
  if (msg.from?.is_bot) return;
  const chatId = String(msg.chat.id);
  if (!allowedChats.has(chatId)) {
    appendLog(`Ignored message from unauthorized chat ${chatId}.`);
    return;
  }
  const text = (msg.text || "").trim();
  if (!text) return;

  try {
    appendLog(`Received from ${chatId} (${msg.from?.username || msg.from?.first_name || "unknown"}): ${text}`);
    if (text === "/ping" || text.toLowerCase() === "ping") {
      await bot.sendMessage(chatId, "pong");
      appendLog(`Sent pong to ${chatId}.`);
      return;
    }
    const reply = await runAgentMessage({ chatId, text });
    if (!reply) return;
    const formatted = renderTelegramHtml(reply);
    await bot.sendMessage(chatId, formatted, {
      disable_web_page_preview: true,
      parse_mode: "HTML",
    });
    appendLog(`Replied to ${chatId} (${reply.length} chars).`);
  } catch (err) {
    console.error("Agent error:", err?.message || err);
    await bot.sendMessage(chatId, "Sorry, I hit an error while processing that.");
    appendLog(`Error replying to ${chatId}: ${err?.stack || err?.message || err}`);
  }
});
