import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { getConfig, validateOpenAIConfig, validateTelegramConfig } from "./config.js";
import { runAgentMessage } from "./agent.js";

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
    await bot.sendMessage(chatId, reply, {
      disable_web_page_preview: true,
    });
    appendLog(`Replied to ${chatId} (${reply.length} chars).`);
  } catch (err) {
    console.error("Agent error:", err?.message || err);
    await bot.sendMessage(chatId, "Sorry, I hit an error while processing that.");
    appendLog(`Error replying to ${chatId}: ${err?.stack || err?.message || err}`);
  }
});
