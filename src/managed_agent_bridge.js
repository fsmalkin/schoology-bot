import { getConfig, validateManagedAgentsConfig } from "./config.js";
import {
  ensureDbSeeded,
  getDb,
  getManagedAgentSession,
  markManagedAgentSessionEvent,
  upsertManagedAgentSession,
} from "./db.js";
import { createManagedAgentClient } from "./managed_agent_client.js";
import {
  MANAGED_AGENT_ALLOWED_BUILTIN_TOOLS,
  MANAGED_AGENT_DEFINITION_REVISION,
} from "./managed_agent_definitions.js";
import { runToolByName, TOOL_NAMES } from "./tool_runner.js";
import { normalizeAscii, sanitizeRepeatedText } from "./text_utils.js";
import {
  buildKidSafeBlockedReply,
  detectKidUnsafeContent,
  KID_SAFE_OUTPUT_FALLBACK,
  safetyDebugPayload,
} from "./kid_safe_content_filter.js";

const ALLOWED_BUILTIN_TOOL_SET = new Set(MANAGED_AGENT_ALLOWED_BUILTIN_TOOLS);
const DEFAULT_MEMORY_STORE_INSTRUCTIONS = [
  "Use this memory store only for durable parent preferences, household workflow conventions, and stable Schoology Bot operating lessons.",
  "Do not store secrets, credentials, tokens, raw Schoology grade details, full assignment lists, private student records, unsafe content, or copied web/fetched content.",
  "Schoology custom tools and local DB results are authoritative for assignments, grades, reminders, tasks, statuses, and notes.",
].join(" ");
const RETRY_SHORTHAND_RE =
  /^(?:try\s+again|retry|again|rerun|run\s+(?:it|that)\s+again|please\s+try\s+again)[.!?]*$/i;
const MAX_RETRY_CONTEXT_CHARS = 2500;
const MAX_RETRY_ERROR_CHARS = 500;

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

function normalizeMemoryStoreAccess(value) {
  const raw = String(value || "read_write").trim().toLowerCase();
  return raw === "read_only" ? "read_only" : "read_write";
}

function buildMemoryStoreResources(config) {
  const managed = config?.managedAgents || {};
  const memoryStoreId = String(managed.memoryStoreId || "").trim();
  if (!memoryStoreId) return [];
  const resource = {
    type: "memory_store",
    memory_store_id: memoryStoreId,
    access: normalizeMemoryStoreAccess(managed.memoryStoreAccess),
    instructions:
      String(managed.memoryStoreInstructions || "").trim() || DEFAULT_MEMORY_STORE_INSTRUCTIONS,
  };
  return [resource];
}

function compactMetadataText(value, maxChars = MAX_RETRY_CONTEXT_CHARS) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function retryCarryoverMetadata(session) {
  const metadata = session?.metadata || {};
  const lastFailedUserText = compactMetadataText(metadata.lastFailedUserText);
  if (!lastFailedUserText) return {};
  return {
    lastFailedUserText,
    lastFailedAt: compactMetadataText(metadata.lastFailedAt, 80) || null,
    lastFailedError: compactMetadataText(metadata.lastFailedError, MAX_RETRY_ERROR_CHARS) || null,
    lastFailedSessionId: session?.sessionId || metadata.lastFailedSessionId || null,
  };
}

function buildRetryRequest(userText, metadata = {}) {
  const text = String(userText || "").trim();
  if (!RETRY_SHORTHAND_RE.test(text)) {
    return { text: String(userText || ""), previousText: null, isRetry: false };
  }
  const previousText = compactMetadataText(metadata.lastFailedUserText);
  if (!previousText) {
    return { text: String(userText || ""), previousText: null, isRetry: false };
  }
  const lastFailedError = compactMetadataText(metadata.lastFailedError, MAX_RETRY_ERROR_CHARS);
  const context = [
    "Local Schoology Bot retry context:",
    'The user just said "try again". Retry the previous failed Telegram request below using the current tools and data.',
    "Do not ask what to retry unless the previous request is unsafe or impossible.",
    "Before performing writes, inspect current state and avoid duplicating any side effect that may already have completed.",
    lastFailedError ? `Previous local failure: ${lastFailedError}` : "",
    "Previous failed request:",
    previousText,
  ].filter(Boolean);
  return { text: context.join("\n\n"), previousText, isRetry: true };
}

function recordManagedAgentFailure(db, { chatId, config, attemptedUserText, error }) {
  try {
    const lastFailedUserText = compactMetadataText(attemptedUserText);
    if (!lastFailedUserText) return;
    const failedAt = new Date().toISOString();
    markManagedAgentSessionEvent(db, {
      chatId,
      environment: normalizeEnvironment(config),
      lastEventAt: failedAt,
      metadata: {
        lastEventType: "telegram_error",
        lastFailedUserText,
        lastFailedAt: failedAt,
        lastFailedError: compactMetadataText(error?.message || String(error || ""), MAX_RETRY_ERROR_CHARS),
      },
    });
  } catch {
    // Failure recording must never mask the original agent error.
  }
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
  return {
    id: eventId(event),
    type,
    name: event?.name || event?.tool_name || event?.toolName || event?.tool?.name || "",
  };
}

async function getOrStartSession({ db, config, client, chatId, now }) {
  const environment = normalizeEnvironment(config);
  const current = getManagedAgentSession(db, chatId, environment, { now });
  const currentRevision = String(current?.metadata?.agentDefinitionRevision || "").trim();
  const expectedRevision = MANAGED_AGENT_DEFINITION_REVISION;
  const isStaleAgentDefinition = Boolean(
    current &&
      current.status === "active" &&
      !current.isExpired &&
      currentRevision !== expectedRevision
  );
  if (current && current.status === "active" && !current.isExpired && !isStaleAgentDefinition) {
    return { sessionId: current.sessionId, created: false, reason: "existing", session: current };
  }

  const reason = current
    ? isStaleAgentDefinition
      ? "agent_definition_revision_changed"
      : current.isExpired
        ? "expired"
        : current.status
    : "missing";
  const resources = buildMemoryStoreResources(config);
  const carryover = retryCarryoverMetadata(current);
  const created = await client.createSession({
    title: `Schoology Bot ${environment} chat ${chatId}`,
    metadata: {
      source: "schoology-bot",
      chat_id: String(chatId),
      environment,
      create_reason: reason,
      agent_definition_revision: expectedRevision,
    },
    resources,
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
      agentDefinitionRevision: expectedRevision,
      memoryStoreIds: resources.map((resource) => resource.memory_store_id),
      ...carryover,
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
    deny_message:
      "Schoology Bot Telegram bridge only grants Schoology custom tools plus web_search/web_fetch.",
  };
}

function toolConfirmationEvent(event) {
  const name = String(event?.name || "").trim();
  if (ALLOWED_BUILTIN_TOOL_SET.has(name)) {
    return {
      type: "user.tool_confirmation",
      tool_use_id: event.id,
      result: "allow",
    };
  }
  return denyToolConfirmationEvent(event);
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
  const inputSafety = detectKidUnsafeContent(text);
  if (!inputSafety.safe) {
    const reply = buildKidSafeBlockedReply(inputSafety);
    if (debug) {
      return {
        reply,
        sessionId: null,
        sessionCreated: false,
        executed: [],
        executedTools: [],
        streamPasses: 0,
        safety: safetyDebugPayload("input", inputSafety),
      };
    }
    return reply;
  }
  const db = dbOverride || getDb(config);
  ensureDbSeeded(db, config.paths.statePath);
  const client = clientOverride || createManagedAgentClient(config.managedAgents);
  const now = new Date().toISOString();
  const sessionInfo = await getOrStartSession({ db, config, client, chatId, now });
  const sessionId = sessionInfo.sessionId;
  const originalText = String(text || "");
  const retryRequest = buildRetryRequest(originalText, sessionInfo.session?.metadata || {});
  const outboundUserText = retryRequest.text;
  const attemptedUserText = retryRequest.previousText || originalText;
  const eventsById = new Map();
  const replyParts = [];
  const seenTextEvents = new Set();
  const executedTools = [];
  const completedActionIds = new Set();

  let streamPasses = 0;
  try {
    await client.sendEvents(sessionId, [
      {
        type: "user.message",
        content: [{ type: "text", text: outboundUserText }],
      },
    ]);

    let finished = false;
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
                  const output = await executeCustomToolUse({
                    db,
                    call,
                    userText: outboundUserText,
                    now: toolNow,
                  });
                  completedActionIds.add(actionId);
                  executedTools.push({ call, output });
                  actionEvents.push(customToolResultEvent(call, output, { maxChars: toolResultMaxChars }));
                  continue;
                }
                const confirmation = extractToolConfirmation(blockedEvent);
                if (confirmation) {
                  completedActionIds.add(actionId);
                  actionEvents.push(toolConfirmationEvent(confirmation));
                }
              }
              if (actionEvents.length > 0) {
                replyParts.length = 0;
                seenTextEvents.clear();
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

    let reply = normalizeAscii(sanitizeRepeatedText(replyParts.join("\n").trim())) || "Done.";
    const outputSafety = detectKidUnsafeContent(reply);
    let safety = null;
    if (!outputSafety.safe) {
      reply = KID_SAFE_OUTPUT_FALLBACK;
      safety = safetyDebugPayload("output", outputSafety);
    }
    markManagedAgentSessionEvent(db, {
      chatId,
      environment: normalizeEnvironment(config),
      lastEventAt: new Date().toISOString(),
      metadata: {
        lastEventType: "telegram_message",
        lastStreamPasses: streamPasses,
        lastToolCount: executedTools.length,
        lastUserText: compactMetadataText(originalText),
        lastRetryUserText: retryRequest.previousText || null,
        lastFailedUserText: null,
        lastFailedAt: null,
        lastFailedError: null,
        lastFailedSessionId: null,
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
        ...(safety ? { safety } : {}),
      };
    }
    return reply;
  } catch (err) {
    recordManagedAgentFailure(db, { chatId, config, attemptedUserText, error: err });
    throw err;
  }
}
