import { getConfig, validateManagedAgentsConfig } from "./config.js";
import {
  ensureDbSeeded,
  getDb,
  getManagedAgentSession,
  markManagedAgentSessionEvent,
  upsertManagedAgentSession,
} from "./db.js";
import { createManagedAgentClient } from "./managed_agent_client.js";
import { runToolByName, TOOL_NAMES } from "./tool_runner.js";
import { normalizeAscii, sanitizeRepeatedText } from "./text_utils.js";

function normalizeEnvironment(config) {
  const managed = config.managedAgents || {};
  const namespace = String(managed.sessionNamespace || managed.environment || "dev").trim().toLowerCase();
  return namespace || "dev";
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function addMinutesIso(baseIso, minutes) {
  const baseMs = parseIsoMs(baseIso) || Date.now();
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(baseMs + n * 60 * 1000).toISOString();
}

function parseToolInput(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function normalizeManagedToolName(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  if (TOOL_NAMES.includes(raw)) return raw;
  for (const prefix of ["schoology.", "schoology_", "schoology-"]) {
    if (raw.startsWith(prefix)) {
      const stripped = raw.slice(prefix.length);
      if (TOOL_NAMES.includes(stripped)) return stripped;
    }
  }
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    TOOL_NAMES.find((toolName) => toolName.toLowerCase().replace(/[^a-z0-9]/g, "") === compact) ||
    null
  );
}

function eventId(event) {
  return event?.id || event?.event_id || event?.eventId || null;
}

function stopReason(event) {
  return event?.stop_reason || event?.stopReason || null;
}

function stopReasonType(reason) {
  if (!reason) return "";
  return typeof reason === "string" ? reason : String(reason.type || "");
}

function stopReasonEventIds(reason) {
  if (!reason || typeof reason === "string") return [];
  return reason.event_ids || reason.eventIds || [];
}

function extractTextBlocks(value, parts = []) {
  if (!value) return parts;
  if (Array.isArray(value)) {
    for (const item of value) extractTextBlocks(item, parts);
    return parts;
  }
  if (typeof value !== "object") return parts;
  if (value.type === "text" && typeof value.text === "string") {
    parts.push(value.text);
    return parts;
  }
  if (typeof value.text === "string" && Object.keys(value).length <= 3) {
    parts.push(value.text);
  }
  for (const key of ["content", "message", "delta", "output"]) {
    extractTextBlocks(value[key], parts);
  }
  return parts;
}

function extractAgentMessageText(event) {
  const type = String(event?.type || "");
  if (!type.startsWith("agent.message")) return "";
  return extractTextBlocks(event).join("");
}

function extractCustomToolUse(event) {
  if (String(event?.type || "") !== "agent.custom_tool_use") return null;
  const id = eventId(event);
  const name = event.name || event.tool_name || event.toolName || event.tool?.name || "";
  return {
    id,
    name,
    input: parseToolInput(event.input || event.arguments || event.tool_input || event.toolInput),
  };
}

function extractToolConfirmation(event) {
  const type = String(event?.type || "");
  if (type !== "agent.tool_use" && type !== "agent.mcp_tool_use") return null;
  return { id: eventId(event), type };
}

async function getOrStartSession({ db, config, client, chatId, now }) {
  const environment = normalizeEnvironment(config);
  const current = getManagedAgentSession(db, chatId, environment, { now });
  if (current && current.status === "active" && !current.isExpired) {
    return { sessionId: current.sessionId, created: false, reason: "existing", session: current };
  }

  const reason = current ? (current.isExpired ? "expired" : current.status) : "missing";
  const created = await client.createSession({
    title: `Schoology Bot ${environment} chat ${chatId}`,
    metadata: {
      source: "schoology-bot",
      chat_id: String(chatId),
      environment,
      create_reason: reason,
    },
  });
  const sessionId = String(created?.id || "").trim();
  if (!sessionId) throw new Error("Claude Managed Agents did not return a session id.");

  const stored = upsertManagedAgentSession(db, {
    chatId,
    environment,
    sessionId,
    provider: "claude",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastEventAt: now,
    expiresAt: addMinutesIso(now, config.managedAgents.sessionTtlMinutes),
    metadata: {
      createReason: reason,
      previousSessionId: current?.sessionId || null,
      claudeStatus: created?.status || null,
      environmentId: config.managedAgents.environmentId,
    },
  });
  return { sessionId, created: true, reason, session: stored.session };
}

async function executeCustomToolUse({ db, call, userText, now }) {
  const toolName = normalizeManagedToolName(call.name);
  if (!call.id) {
    return { ok: false, error: "Custom tool event is missing an id." };
  }
  if (!toolName) {
    return { ok: false, error: `Unsupported Schoology tool: ${call.name || "unknown"}` };
  }
  return await runToolByName(db, toolName, call.input || {}, { userText, now });
}

function serializeToolOutput(output, maxChars) {
  const raw = JSON.stringify(output);
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0 || raw.length <= limit) return raw;
  return JSON.stringify({
    ok: output?.ok !== false,
    truncated: true,
    originalLength: raw.length,
    preview: raw.slice(0, limit),
  });
}

function customToolResultEvent(call, output, { maxChars = 20000 } = {}) {
  return {
    type: "user.custom_tool_result",
    custom_tool_use_id: call.id,
    content: [
      {
        type: "text",
        text: serializeToolOutput(output, maxChars),
      },
    ],
  };
}

function denyToolConfirmationEvent(event) {
  return {
    type: "user.tool_confirmation",
    tool_use_id: event.id,
    result: "deny",
    deny_message: "Schoology Bot Telegram bridge only grants local Schoology custom tools.",
  };
}

export async function runManagedAgentMessage({
  chatId,
  text,
  clientOverride = null,
  configOverride = null,
  dbOverride = null,
  toolNow = null,
  debug = false,
} = {}) {
  const config = configOverride || getConfig();
  validateManagedAgentsConfig(config);
  const db = dbOverride || getDb(config);
  ensureDbSeeded(db, config.paths.statePath);
  const client = clientOverride || createManagedAgentClient(config.managedAgents);
  const now = new Date().toISOString();
  const sessionInfo = await getOrStartSession({ db, config, client, chatId, now });
  const sessionId = sessionInfo.sessionId;
  const eventsById = new Map();
  const replyParts = [];
  const seenTextEvents = new Set();
  const executedTools = [];
  const completedActionIds = new Set();

  await client.sendEvents(sessionId, [
    {
      type: "user.message",
      content: [{ type: "text", text: String(text || "") }],
    },
  ]);

  let finished = false;
  let streamPasses = 0;
  const maxToolRounds = Number(config.managedAgents.maxToolRounds || 8);
  const timeoutMs = Number(config.managedAgents.streamTimeoutMs || 120000);
  const toolResultMaxChars = Number(config.managedAgents.toolResultMaxChars || 20000);

  while (!finished && streamPasses < Math.max(1, maxToolRounds)) {
    streamPasses += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let sentActions = false;
    try {
      for await (const event of client.streamEvents(sessionId, { signal: controller.signal })) {
        const id = eventId(event);
        if (id) eventsById.set(id, event);

        const messageText = extractAgentMessageText(event);
        if (messageText && (!id || !seenTextEvents.has(id))) {
          if (id) seenTextEvents.add(id);
          replyParts.push(messageText);
        }

        const customTool = extractCustomToolUse(event);
        if (customTool?.id) {
          eventsById.set(customTool.id, event);
        }

        if (String(event?.type || "") === "session.error") {
          throw new Error(event?.error?.message || event?.message || "Claude Managed Agents session error.");
        }

        if (String(event?.type || "") === "session.status_idle") {
          const reason = stopReason(event);
          const reasonType = stopReasonType(reason);
          if (reasonType === "requires_action") {
            const actionEvents = [];
            const actionIds = Array.from(
              new Set(stopReasonEventIds(reason).filter(Boolean).map((value) => String(value)))
            );
            for (const actionId of actionIds) {
              if (completedActionIds.has(actionId)) continue;
              const blockedEvent = eventsById.get(actionId);
              const call = extractCustomToolUse(blockedEvent);
              if (call) {
                const output = await executeCustomToolUse({ db, call, userText: text, now: toolNow });
                completedActionIds.add(actionId);
                executedTools.push({ call, output });
                actionEvents.push(customToolResultEvent(call, output, { maxChars: toolResultMaxChars }));
                continue;
              }
              const confirmation = extractToolConfirmation(blockedEvent);
              if (confirmation) {
                completedActionIds.add(actionId);
                actionEvents.push(denyToolConfirmationEvent(confirmation));
              }
            }
            if (actionEvents.length > 0) {
              await client.sendEvents(sessionId, actionEvents);
              sentActions = true;
            } else if (actionIds.length > 0 && actionIds.every((actionId) => completedActionIds.has(actionId))) {
              sentActions = true;
            } else {
              throw new Error("Claude Managed Agents required an unsupported action.");
            }
            continue;
          }
          finished = true;
          break;
        }
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Claude Managed Agents stream timed out.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!sentActions) break;
  }

  if (!finished && streamPasses >= Math.max(1, maxToolRounds)) {
    throw new Error("Claude Managed Agents exceeded the local tool round limit.");
  }

  const reply = normalizeAscii(sanitizeRepeatedText(replyParts.join("\n").trim())) || "Done.";
  markManagedAgentSessionEvent(db, {
    chatId,
    environment: normalizeEnvironment(config),
    lastEventAt: new Date().toISOString(),
    metadata: {
      lastEventType: "telegram_message",
      lastStreamPasses: streamPasses,
      lastToolCount: executedTools.length,
    },
  });

  if (debug) {
    const executed = executedTools.map((entry) => ({
      call: {
        name: normalizeManagedToolName(entry.call?.name) || entry.call?.name || "",
        arguments: entry.call?.input || {},
      },
      output: entry.output,
    }));
    return {
      reply,
      sessionId,
      sessionCreated: sessionInfo.created,
      executed,
      executedTools,
      streamPasses,
    };
  }
  return reply;
}
