export function normalizeTelegramThreadId(value) {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return "";
  return String(parsed);
}

export function buildTelegramThreadOptions(threadId, baseOptions = {}) {
  const normalized = normalizeTelegramThreadId(threadId);
  if (!normalized) return { ...baseOptions };
  return {
    ...baseOptions,
    message_thread_id: Number(normalized),
  };
}

export function buildTelegramTargetKey(chatId, threadId = "") {
  const chat = String(chatId || "").trim();
  const thread = normalizeTelegramThreadId(threadId);
  return thread ? `${chat}:thread:${thread}` : chat;
}

export function formatTelegramTarget(chatId, threadId = "") {
  const thread = normalizeTelegramThreadId(threadId);
  return thread ? `${chatId} thread ${thread}` : String(chatId);
}
