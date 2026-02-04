import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { getConfig, validateOpenAIConfig, validateTelegramConfig } from "./config.js";
import { runAgentMessage } from "./agent.js";
import { renderTelegramHtml } from "./telegram_format.js";
import { batchMessages } from "./telegram_queue.js";

const config = getConfig();
validateTelegramConfig();
validateOpenAIConfig();

const allowedChats = new Set((config.telegram.chatIds || []).map((id) => String(id)));
const bot = new TelegramBot(config.telegram.botToken, { polling: true });
const logPath =
  process.env.AGENT_LOG_PATH && process.env.AGENT_LOG_PATH.trim().length > 0
    ? process.env.AGENT_LOG_PATH.trim()
    : path.join(config.paths.dataDir, "agent.log");

const lockPath = path.join(config.paths.dataDir, "telegram_agent.lock");
const queueByChat = new Map();
const timerByChat = new Map();
const processedIds = new Map();
const MESSAGE_DEDUP_MS = 5 * 60 * 1000;
const BATCH_DELAY_MS = 1200;
const MAX_BATCH_CHARS = 3500;
const TYPING_INTERVAL_MS = 4000;
const WORKING_MESSAGE_DELAY_MS = 10000;

function acquireLock() {
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, "utf8");
      const existing = JSON.parse(raw);
      if (existing?.pid) {
        if (existing.pid === process.pid) {
          // same process, safe to continue
        } else {
          try {
            process.kill(existing.pid, 0);
            console.error(`Another agent instance is already running (pid ${existing.pid}).`);
            process.exit(1);
          } catch (err) {
            // stale lock
          }
        }
      }
    }
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
  } catch (err) {
    console.warn("Failed to create lock file:", err?.message || err);
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch (err) {
    // ignore
  }
}

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
acquireLock();

const MAX_BACKOFF_MS = 60000;
let restartAttempts = 0;
let restartTimer = null;
let restartInProgress = false;
let stabilityTimer = null;
const STABLE_RESET_MS = 60000;

function formatError(err) {
  if (!err) return "Unknown error";
  return err.response?.body || err.message || String(err);
}

function schedulePollingRestart(err) {
  if (restartTimer) return;
  const message = String(err?.message || err || "");
  const isDns = message.includes("ENOTFOUND");
  const baseDelay = isDns ? 5000 : 1000;
  const delay = Math.min(baseDelay * Math.pow(2, restartAttempts), MAX_BACKOFF_MS);
  restartAttempts += 1;
  appendLog(`Polling error: ${formatError(err)}. Restarting in ${Math.round(delay / 1000)}s.`);

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      if (restartInProgress) return;
      restartInProgress = true;
      appendLog("Restarting Telegram polling...");
      await bot.stopPolling();
      await bot.startPolling();
      appendLog("Telegram polling restarted.");
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(() => {
        restartAttempts = 0;
      }, STABLE_RESET_MS);
    } catch (restartErr) {
      appendLog(`Polling restart failed: ${formatError(restartErr)}`);
      schedulePollingRestart(restartErr);
    } finally {
      restartInProgress = false;
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

  const msgId = String(msg.message_id || "");
  const now = Date.now();
  if (msgId) {
    const lastSeen = processedIds.get(msgId);
    if (lastSeen && now - lastSeen < MESSAGE_DEDUP_MS) return;
    processedIds.set(msgId, now);
  }

  const queue = queueByChat.get(chatId) || [];
  queue.push(text);
  queueByChat.set(chatId, queue);

  for (const [id, ts] of processedIds.entries()) {
    if (now - ts > MESSAGE_DEDUP_MS) processedIds.delete(id);
  }

  if (timerByChat.has(chatId)) return;
  timerByChat.set(
    chatId,
    setTimeout(async () => {
      timerByChat.delete(chatId);
      const items = queueByChat.get(chatId) || [];
      queueByChat.set(chatId, []);
      if (items.length === 0) return;
      const combined = batchMessages(items, MAX_BATCH_CHARS);

      let typingTimer = null;
      let workingTimer = null;
      let workingMessageId = null;
      const startTyping = async () => {
        try {
          await bot.sendChatAction(chatId, "typing");
        } catch (err) {
          // ignore typing errors
        }
      };
      const stopTyping = () => {
        if (typingTimer) clearInterval(typingTimer);
        if (workingTimer) clearTimeout(workingTimer);
        typingTimer = null;
        workingTimer = null;
      };

      try {
        appendLog(`Received batch from ${chatId} (${items.length} messages).`);

        await startTyping();
        typingTimer = setInterval(startTyping, TYPING_INTERVAL_MS);
        workingTimer = setTimeout(async () => {
          try {
            const msg = await bot.sendMessage(chatId, "Working on it...");
            workingMessageId = msg?.message_id || null;
          } catch (err) {
            // ignore
          }
        }, WORKING_MESSAGE_DELAY_MS);

        if (combined === "/ping" || combined.toLowerCase() === "ping") {
          await bot.sendMessage(chatId, "pong");
          appendLog(`Sent pong to ${chatId}.`);
          return;
        }
        const reply = await runAgentMessage({ chatId, text: combined });
        if (!reply) return;
        const formatted = renderTelegramHtml(reply);
        if (workingMessageId) {
          try {
            await bot.editMessageText(formatted, {
              chat_id: chatId,
              message_id: workingMessageId,
              disable_web_page_preview: true,
              parse_mode: "HTML",
            });
          } catch (err) {
            await bot.sendMessage(chatId, formatted, {
              disable_web_page_preview: true,
              parse_mode: "HTML",
            });
          }
        } else {
          await bot.sendMessage(chatId, formatted, {
            disable_web_page_preview: true,
            parse_mode: "HTML",
          });
        }
        appendLog(`Replied to ${chatId} (${reply.length} chars).`);
      } catch (err) {
        console.error("Agent error:", err?.message || err);
        try {
          await bot.sendMessage(chatId, "Sorry, I hit an error while processing that.");
        } catch (sendErr) {
          // ignore
        }
        appendLog(`Error replying to ${chatId}: ${err?.stack || err?.message || err}`);
      } finally {
        stopTyping();
      }
    }, BATCH_DELAY_MS)
  );
});

process.on("SIGINT", () => {
  releaseLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  releaseLock();
  process.exit(0);
});
