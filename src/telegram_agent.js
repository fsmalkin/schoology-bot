import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import {
  getConfig,
  isManagedAgentsRuntime,
  validateAgentRuntimeConfig,
  validateTelegramConfig,
} from "./config.js";
import { runChatMessage } from "./agent_runtime.js";
import { renderTelegramHtml, renderTelegramPlain } from "./telegram_format.js";
import { batchMessages } from "./telegram_queue.js";
import { getDb } from "./db.js";
import { writeServiceHeartbeat } from "./health.js";
import {
  MANAGED_AGENT_BRIDGE_SERVICE,
  resetIdleManagedAgentSessions,
} from "./managed_agent_status.js";
import { redactSensitiveString } from "./sensitive_redaction.js";
import {
  buildTelegramTargetKey,
  buildTelegramThreadOptions,
  formatTelegramTarget,
  normalizeTelegramThreadId,
} from "./telegram_threading.js";

const config = getConfig();
validateTelegramConfig();
validateAgentRuntimeConfig();

const allowedChats = new Set((config.telegram.chatIds || []).map((id) => String(id)));
const bot = new TelegramBot(config.telegram.botToken, { polling: true });
const logPath =
  process.env.AGENT_LOG_PATH && process.env.AGENT_LOG_PATH.trim().length > 0
    ? process.env.AGENT_LOG_PATH.trim()
    : path.join(config.paths.dataDir, "agent.log");

const lockPath = path.join(config.paths.dataDir, "telegram_agent.lock");
const queueByChat = new Map();
const timerByChat = new Map();
const targetByKey = new Map();
const processingByChat = new Set();
const processedIds = new Map();
const MESSAGE_DEDUP_MS = 5 * 60 * 1000;
const BATCH_DELAY_MS = 1200;
const MAX_BATCH_CHARS = 3500;
const TYPING_INTERVAL_MS = 4000;
const WORKING_MESSAGE_DELAY_MS = 10000;
const MANAGED_IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastManagedIdleSweepAt = 0;
const runtime = {
  startedAt: new Date().toISOString(),
  lastMessageAt: null,
  lastReplyAt: null,
  lastErrorAt: null,
  lastError: null,
  restartAttempts: 0,
  managedIdleSweep: null,
};

function maybeSweepManagedIdleSessions() {
  if (!isManagedAgentsRuntime(config)) return null;
  const now = Date.now();
  if (lastManagedIdleSweepAt && now - lastManagedIdleSweepAt < MANAGED_IDLE_SWEEP_INTERVAL_MS) {
    return runtime.managedIdleSweep;
  }
  lastManagedIdleSweepAt = now;
  try {
    const result = resetIdleManagedAgentSessions({
      db: getDb(config),
      config,
      now: new Date(now),
    });
    runtime.managedIdleSweep = {
      checked: result.checked || 0,
      reset: result.reset || 0,
      ranAt: new Date(now).toISOString(),
    };
  } catch (err) {
    runtime.managedIdleSweep = {
      error: redactSensitiveString(err?.message || String(err)),
      ranAt: new Date(now).toISOString(),
    };
  }
  return runtime.managedIdleSweep;
}

function updateHeartbeat(extra = {}) {
  try {
    const queuedMessages = Array.from(queueByChat.values()).reduce((sum, items) => {
      return sum + (Array.isArray(items) ? items.length : 0);
    }, 0);
    const managedIdleSweep = maybeSweepManagedIdleSessions();
    const payload = {
      status: "running",
      allowedChats: allowedChats.size,
      queuedMessages,
      processingChats: processingByChat.size,
      ...runtime,
      ...extra,
    };
    writeServiceHeartbeat(config, "telegram-agent", payload);
    if (isManagedAgentsRuntime(config)) {
      writeServiceHeartbeat(config, MANAGED_AGENT_BRIDGE_SERVICE, {
        status: payload.status,
        environment: config.managedAgents.sessionNamespace || config.managedAgents.environment,
        router: "telegram-agent",
        queuedMessages,
        processingChats: processingByChat.size,
        lastMessageAt: runtime.lastMessageAt,
        lastReplyAt: runtime.lastReplyAt,
        lastErrorAt: runtime.lastErrorAt,
        lastError: runtime.lastError ? redactSensitiveString(runtime.lastError) : null,
        idleSweep: managedIdleSweep,
      });
    }
  } catch (err) {
    // heartbeat failures should not stop the agent
  }
}

async function sendFormattedMessage(chatId, text, options = {}) {
  const formatted = renderTelegramHtml(text);
  const plain = renderTelegramPlain(text);
  const editMessageId = options.editMessageId || null;
  const threadId = normalizeTelegramThreadId(options.threadId);

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
      ...buildTelegramThreadOptions(threadId, {
        disable_web_page_preview: true,
        parse_mode: "HTML",
      }),
    });
    return { edited: false, usedHtml: true, messageId: msg?.message_id || null };
  } catch (err) {
    const msg = await bot.sendMessage(chatId, plain, {
      ...buildTelegramThreadOptions(threadId, {
        disable_web_page_preview: true,
      }),
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
  return redactSensitiveString(err.response?.body || err.message || String(err));
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
  const threadId =
    normalizeTelegramThreadId(msg.message_thread_id) ||
    normalizeTelegramThreadId(config.telegram.messageThreadId);
  const targetKey = buildTelegramTargetKey(chatId, threadId);
  targetByKey.set(targetKey, { chatId, threadId });

  const msgId = String(msg.message_id || "");
  const msgDedupKey = msgId ? `${targetKey}:message:${msgId}` : "";
  const now = Date.now();
  if (msgDedupKey) {
    const lastSeen = processedIds.get(msgDedupKey);
    if (lastSeen && now - lastSeen < MESSAGE_DEDUP_MS) return;
    processedIds.set(msgDedupKey, now);
  }

  const queue = queueByChat.get(targetKey) || [];
  queue.push(text);
  queueByChat.set(targetKey, queue);

  for (const [id, ts] of processedIds.entries()) {
    if (now - ts > MESSAGE_DEDUP_MS) processedIds.delete(id);
  }

  scheduleProcessing(targetKey);
  updateHeartbeat();
});

function scheduleProcessing(targetKey) {
  if (timerByChat.has(targetKey)) return;
  timerByChat.set(
    targetKey,
    setTimeout(() => {
      timerByChat.delete(targetKey);
      processQueue(targetKey);
    }, BATCH_DELAY_MS)
  );
}

async function processQueue(targetKey) {
  if (processingByChat.has(targetKey)) {
    scheduleProcessing(targetKey);
    return;
  }
  processingByChat.add(targetKey);
  const target = targetByKey.get(targetKey) || { chatId: targetKey, threadId: "" };
  const { chatId, threadId } = target;
  const targetLabel = formatTelegramTarget(chatId, threadId);

  let typingTimer = null;
  let workingTimer = null;
  let workingMessageId = null;
  let responseSent = false;

  const startTyping = async () => {
    try {
      await bot.sendChatAction(chatId, "typing", buildTelegramThreadOptions(threadId));
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
    const items = queueByChat.get(targetKey) || [];
    queueByChat.set(targetKey, []);
    if (items.length === 0) return;
    const combined = batchMessages(items, MAX_BATCH_CHARS);

    appendLog(`Received batch from ${targetLabel} (${items.length} messages).`);

    await startTyping();
    typingTimer = setInterval(startTyping, TYPING_INTERVAL_MS);
    workingTimer = setTimeout(async () => {
      try {
        if (responseSent) return;
        const msg = await bot.sendMessage(
          chatId,
          "Working on it...",
          buildTelegramThreadOptions(threadId)
        );
        workingMessageId = msg?.message_id || null;
      } catch (err) {
        // ignore
      }
    }, WORKING_MESSAGE_DELAY_MS);

    if (combined === "/ping" || combined.toLowerCase() === "ping") {
      responseSent = true;
      await bot.sendMessage(chatId, "pong", buildTelegramThreadOptions(threadId));
      appendLog(`Sent pong to ${targetLabel}.`);
      runtime.lastReplyAt = new Date().toISOString();
      runtime.lastError = null;
      runtime.lastErrorAt = null;
      updateHeartbeat();
      return;
    }

    const reply = await runChatMessage({ chatId: targetKey, text: combined });
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
    const result = await sendFormattedMessage(chatId, reply, {
      editMessageId: workingMessageId,
      threadId,
    });
    if (workingMessageId && !result.edited) {
      try {
        await bot.deleteMessage(chatId, workingMessageId);
      } catch (err) {
        // ignore delete errors
      }
    }
    appendLog(`Replied to ${targetLabel} (${reply.length} chars).`);
    runtime.lastReplyAt = new Date().toISOString();
    runtime.lastError = null;
    runtime.lastErrorAt = null;
    updateHeartbeat();
  } catch (err) {
    console.error("Agent error:", redactSensitiveString(err?.message || String(err)));
    try {
      await bot.sendMessage(
        chatId,
        "Sorry, I hit an error while processing that.",
        buildTelegramThreadOptions(threadId)
      );
    } catch (sendErr) {
      // ignore
    }
    appendLog(`Error replying to ${targetLabel}: ${redactSensitiveString(err?.stack || err?.message || String(err))}`);
    runtime.lastErrorAt = new Date().toISOString();
    runtime.lastError = redactSensitiveString(err?.message || String(err));
    updateHeartbeat();
  } finally {
    stopTyping();
    processingByChat.delete(targetKey);
    if ((queueByChat.get(targetKey) || []).length > 0) {
      scheduleProcessing(targetKey);
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
