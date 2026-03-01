import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { getConfig, validateOpenAIConfig, validateTelegramConfig } from "./config.js";
import { runAgentMessage } from "./agent.js";
import { renderTelegramHtml, renderTelegramPlain } from "./telegram_format.js";
import { batchMessages } from "./telegram_queue.js";
import { writeServiceHeartbeat } from "./health.js";

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
const processingByChat = new Set();
const processedIds = new Map();
const MESSAGE_DEDUP_MS = 5 * 60 * 1000;
const BATCH_DELAY_MS = 1200;
const MAX_BATCH_CHARS = 3500;
const TYPING_INTERVAL_MS = 4000;
const WORKING_MESSAGE_DELAY_MS = 10000;
const runtime = {
  startedAt: new Date().toISOString(),
  lastMessageAt: null,
  lastReplyAt: null,
  lastErrorAt: null,
  lastError: null,
  restartAttempts: 0,
};

function updateHeartbeat(extra = {}) {
  try {
    const queuedMessages = Array.from(queueByChat.values()).reduce((sum, items) => {
      return sum + (Array.isArray(items) ? items.length : 0);
    }, 0);
    writeServiceHeartbeat(config, "telegram-agent", {
      status: "running",
      allowedChats: allowedChats.size,
      queuedMessages,
      processingChats: processingByChat.size,
      ...runtime,
      ...extra,
    });
  } catch (err) {
    // heartbeat failures should not stop the agent
  }
}

async function sendFormattedMessage(chatId, text, options = {}) {
  const formatted = renderTelegramHtml(text);
  const plain = renderTelegramPlain(text);
  const editMessageId = options.editMessageId || null;

  if (editMessageId) {
    try {
      await bot.editMessageText(formatted, {
        chat_id: chatId,
        message_id: editMessageId,
        disable_web_page_preview: true,
        parse_mode: "HTML",
      });
      return { edited: true, usedHtml: true, messageId: editMessageId };
    } catch (err) {
      // fall through to send new message
    }
  }

  try {
    const msg = await bot.sendMessage(chatId, formatted, {
      disable_web_page_preview: true,
      parse_mode: "HTML",
    });
    return { edited: false, usedHtml: true, messageId: msg?.message_id || null };
  } catch (err) {
    const msg = await bot.sendMessage(chatId, plain, {
      disable_web_page_preview: true,
    });
    return { edited: false, usedHtml: false, messageId: msg?.message_id || null };
  }
}

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
            // Guard against stale pid reuse by confirming this pid is actually another
            // telegram agent process on Linux runtimes.
            const isLinux = process.platform === "linux";
            let isTelegramAgentProcess = true;
            if (isLinux) {
              try {
                const cmdlinePath = `/proc/${existing.pid}/cmdline`;
                if (fs.existsSync(cmdlinePath)) {
                  const cmdline = fs.readFileSync(cmdlinePath, "utf8").replace(/\u0000/g, " ");
                  isTelegramAgentProcess = cmdline.includes("telegram_agent.js");
                }
              } catch {
                // If cmdline cannot be read, fall back to conservative behavior.
                isTelegramAgentProcess = true;
              }
            }
            if (isTelegramAgentProcess) {
              console.error(`Another agent instance is already running (pid ${existing.pid}).`);
              process.exit(1);
            }
            // Stale lock from unrelated pid reuse; allow startup.
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
updateHeartbeat();
setInterval(() => updateHeartbeat(), 30000);

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
  runtime.restartAttempts = restartAttempts;
  runtime.lastErrorAt = new Date().toISOString();
  runtime.lastError = formatError(err);
  appendLog(`Polling error: ${formatError(err)}. Restarting in ${Math.round(delay / 1000)}s.`);
  updateHeartbeat();

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      if (restartInProgress) return;
      restartInProgress = true;
      appendLog("Restarting Telegram polling...");
      await bot.stopPolling();
      await bot.startPolling();
      appendLog("Telegram polling restarted.");
      runtime.lastError = null;
      runtime.lastErrorAt = null;
      updateHeartbeat();
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(() => {
        restartAttempts = 0;
        runtime.restartAttempts = 0;
        updateHeartbeat();
      }, STABLE_RESET_MS);
    } catch (restartErr) {
      appendLog(`Polling restart failed: ${formatError(restartErr)}`);
      runtime.lastErrorAt = new Date().toISOString();
      runtime.lastError = formatError(restartErr);
      updateHeartbeat();
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
  runtime.lastMessageAt = new Date().toISOString();

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

  scheduleProcessing(chatId);
  updateHeartbeat();
});

function scheduleProcessing(chatId) {
  if (timerByChat.has(chatId)) return;
  timerByChat.set(
    chatId,
    setTimeout(() => {
      timerByChat.delete(chatId);
      processQueue(chatId);
    }, BATCH_DELAY_MS)
  );
}

async function processQueue(chatId) {
  if (processingByChat.has(chatId)) {
    scheduleProcessing(chatId);
    return;
  }
  processingByChat.add(chatId);

  let typingTimer = null;
  let workingTimer = null;
  let workingMessageId = null;
  let responseSent = false;

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
    const items = queueByChat.get(chatId) || [];
    queueByChat.set(chatId, []);
    if (items.length === 0) return;
    const combined = batchMessages(items, MAX_BATCH_CHARS);

    appendLog(`Received batch from ${chatId} (${items.length} messages).`);

    await startTyping();
    typingTimer = setInterval(startTyping, TYPING_INTERVAL_MS);
    workingTimer = setTimeout(async () => {
      try {
        if (responseSent) return;
        const msg = await bot.sendMessage(chatId, "Working on it...");
        workingMessageId = msg?.message_id || null;
      } catch (err) {
        // ignore
      }
    }, WORKING_MESSAGE_DELAY_MS);

    if (combined === "/ping" || combined.toLowerCase() === "ping") {
      responseSent = true;
      await bot.sendMessage(chatId, "pong");
      appendLog(`Sent pong to ${chatId}.`);
      runtime.lastReplyAt = new Date().toISOString();
      runtime.lastError = null;
      runtime.lastErrorAt = null;
      updateHeartbeat();
      return;
    }

    const reply = await runAgentMessage({ chatId, text: combined });
    responseSent = true;
    if (workingTimer) {
      clearTimeout(workingTimer);
      workingTimer = null;
    }
    if (!reply) {
      if (workingMessageId) {
        try {
          await bot.deleteMessage(chatId, workingMessageId);
        } catch (err) {
          // ignore delete errors
        }
      }
      return;
    }
    const result = await sendFormattedMessage(chatId, reply, { editMessageId: workingMessageId });
    if (workingMessageId && !result.edited) {
      try {
        await bot.deleteMessage(chatId, workingMessageId);
      } catch (err) {
        // ignore delete errors
      }
    }
    appendLog(`Replied to ${chatId} (${reply.length} chars).`);
    runtime.lastReplyAt = new Date().toISOString();
    runtime.lastError = null;
    runtime.lastErrorAt = null;
    updateHeartbeat();
  } catch (err) {
    console.error("Agent error:", err?.message || err);
    try {
      await bot.sendMessage(chatId, "Sorry, I hit an error while processing that.");
    } catch (sendErr) {
      // ignore
    }
    appendLog(`Error replying to ${chatId}: ${err?.stack || err?.message || err}`);
    runtime.lastErrorAt = new Date().toISOString();
    runtime.lastError = err?.message || String(err);
    updateHeartbeat();
  } finally {
    stopTyping();
    processingByChat.delete(chatId);
    if ((queueByChat.get(chatId) || []).length > 0) {
      scheduleProcessing(chatId);
    }
  }
}

process.on("SIGINT", () => {
  updateHeartbeat({ status: "stopping" });
  releaseLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  updateHeartbeat({ status: "stopping" });
  releaseLock();
  process.exit(0);
});
