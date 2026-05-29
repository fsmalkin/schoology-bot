import { isManagedAgentsRuntime } from "./config.js";
import {
  listManagedAgentEvents,
  listManagedAgentSessions,
  recordManagedAgentEvent,
  resetManagedAgentSession,
} from "./db.js";
import { sanitizeForLocalLog } from "./sensitive_redaction.js";

export const MANAGED_AGENT_BRIDGE_SERVICE = "managed-agent-bridge";

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function nowMs(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function safePositiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function compactSessionId(value) {
  const text = String(value || "").trim();
  if (!text || text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

export function normalizeManagedAgentEnvironment(config) {
  const managed = config?.managedAgents || {};
  const environment = String(managed.sessionNamespace || managed.environment || "dev")
    .trim()
    .toLowerCase();
  return environment || "dev";
}

export function sanitizeManagedAgentEventMetadata(value, depth = 0) {
  return sanitizeForLocalLog(value, depth);
}

export function shouldResetManagedSessionForIdle(session, managedConfig = {}, now = new Date()) {
  const timeoutMinutes = safePositiveNumber(managedConfig?.idleTimeoutMinutes, 0);
  const lastActivityAt = session?.lastEventAt || session?.updatedAt || session?.createdAt || null;
  const currentMs = nowMs(now);
  const lastMs = parseIsoMs(lastActivityAt);
  const idleMs = lastMs === null ? null : Math.max(0, currentMs - lastMs);

  if (!session || session.status !== "active") {
    return { reset: false, reason: "not_active", idleMs, timeoutMinutes, lastActivityAt };
  }
  if (session.isExpired) {
    return { reset: false, reason: "ttl_expired", idleMs, timeoutMinutes, lastActivityAt };
  }
  if (!timeoutMinutes || idleMs === null) {
    return { reset: false, reason: "idle_policy_disabled", idleMs, timeoutMinutes, lastActivityAt };
  }

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const reset = idleMs >= timeoutMs;
  return {
    reset,
    reason: reset ? "idle_timeout" : "within_idle_timeout",
    idleMs,
    idleMinutes: idleMs / 60000,
    timeoutMinutes,
    lastActivityAt,
  };
}

function summarizeSession(session, managedConfig, now) {
  const decision = shouldResetManagedSessionForIdle(session, managedConfig, now);
  const currentMs = nowMs(now);
  const createdMs = parseIsoMs(session?.createdAt);
  const expiresMs = parseIsoMs(session?.expiresAt);
  const ageMs = createdMs === null ? null : Math.max(0, currentMs - createdMs);
  const ttlMs =
    createdMs === null || expiresMs === null ? null : Math.max(0, expiresMs - createdMs);
  const ttlUsedRatio =
    ageMs === null || ttlMs === null || ttlMs <= 0 ? null : Math.min(1, ageMs / ttlMs);
  const timeoutMinutes = safePositiveNumber(managedConfig?.idleTimeoutMinutes, 0);
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const idleWarning =
    !decision.reset &&
    Number.isFinite(decision.idleMs) &&
    timeoutMs > 0 &&
    decision.idleMs >= timeoutMs * 0.8;
  const ttlWarning = ttlUsedRatio !== null && ttlUsedRatio >= 0.8 && !session?.isExpired;
  const costRisk = Boolean(session?.status === "active" && !session?.isExpired && (idleWarning || ttlWarning));

  return {
    chatId: String(session?.chatId || ""),
    environment: session?.environment || "",
    provider: session?.provider || "claude",
    sessionId: compactSessionId(session?.sessionId),
    status: session?.status || "unknown",
    createdAt: session?.createdAt || null,
    updatedAt: session?.updatedAt || null,
    lastEventAt: session?.lastEventAt || null,
    expiresAt: session?.expiresAt || null,
    isExpired: Boolean(session?.isExpired),
    idleExpired: Boolean(decision.reset),
    idleWarning,
    ttlWarning,
    costRisk,
    idleMs: decision.idleMs,
    ageMs,
    lastEventType: session?.metadata?.lastEventType || null,
    createReason: session?.metadata?.createReason || null,
    resetReason: session?.metadata?.resetReason || null,
    agentDefinitionRevision: session?.metadata?.agentDefinitionRevision || null,
  };
}

export function buildManagedAgentStatus({
  db,
  config,
  now = new Date(),
  sessionLimit = 100,
  eventLimit = 12,
} = {}) {
  const managedConfig = config?.managedAgents || {};
  const environment = normalizeManagedAgentEnvironment(config);
  const sessions = db
    ? listManagedAgentSessions(db, {
        environment,
        limit: sessionLimit,
        now: now instanceof Date ? now.toISOString() : String(now),
      })
    : [];
  const events = db ? listManagedAgentEvents(db, { environment, limit: eventLimit }) : [];
  const recentSessions = sessions.map((session) => summarizeSession(session, managedConfig, now));
  const recentEvents = events.map((event) => ({
    ...event,
    sessionId: compactSessionId(event.sessionId),
    metadata: sanitizeManagedAgentEventMetadata(event.metadata || {}),
  }));
  const alerts = [];
  const activeSessionCount = recentSessions.filter(
    (session) => session.status === "active" && !session.isExpired
  ).length;
  const idleRiskCount = recentSessions.filter((session) => session.idleExpired || session.costRisk).length;
  const errorEvents = recentEvents.filter((event) => event.status === "error");
  const repeatedToolErrors = recentEvents.filter(
    (event) => event.status === "error" && /tool/i.test(event.eventType || "")
  );

  if (idleRiskCount > 0) {
    alerts.push({
      severity: "warning",
      message: `${idleRiskCount} managed session(s) are near or past idle/TTL policy.`,
    });
  }
  if (errorEvents.length > 0) {
    alerts.push({
      severity: "error",
      message: `${errorEvents.length} recent Managed Agents error event(s).`,
    });
  }
  if (repeatedToolErrors.length >= 3) {
    alerts.push({
      severity: "warning",
      message: "Repeated managed tool errors detected in recent events.",
    });
  }

  return {
    enabled: isManagedAgentsRuntime(config) || sessions.length > 0 || events.length > 0,
    environment,
    serviceName: MANAGED_AGENT_BRIDGE_SERVICE,
    idleTimeoutMinutes: managedConfig.idleTimeoutMinutes || null,
    sessionTtlMinutes: managedConfig.sessionTtlMinutes || null,
    activeSessionCount,
    latestSession: recentSessions[0] || null,
    recentSessions,
    recentEvents,
    alerts,
  };
}

export function resetIdleManagedAgentSessions({
  db,
  config,
  now = new Date(),
  limit = 100,
  reason = "idle_timeout_sweep",
} = {}) {
  if (!db) return { ok: false, error: "DB is required.", checked: 0, reset: 0 };
  const managedConfig = config?.managedAgents || {};
  const environment = normalizeManagedAgentEnvironment(config);
  const nowIso = now instanceof Date ? now.toISOString() : String(now || new Date().toISOString());
  const sessions = listManagedAgentSessions(db, {
    environment,
    status: "active",
    limit,
    now: nowIso,
  });
  let reset = 0;
  for (const session of sessions) {
    const decision = shouldResetManagedSessionForIdle(session, managedConfig, nowIso);
    if (!decision.reset) continue;
    const result = resetManagedAgentSession(db, {
      chatId: session.chatId,
      environment,
      resetAt: nowIso,
      reason,
    });
    if ((result.reset || 0) > 0) {
      reset += 1;
      recordManagedAgentEvent(db, {
        chatId: session.chatId,
        environment,
        sessionId: session.sessionId,
        eventType: "session_idle_reset",
        status: "warning",
        summary: "Managed session reset by idle sweep.",
        metadata: {
          idleMs: decision.idleMs,
          idleMinutes: decision.idleMinutes,
          timeoutMinutes: decision.timeoutMinutes,
          lastActivityAt: decision.lastActivityAt,
          reason,
        },
        createdAt: nowIso,
      });
    }
  }
  return { ok: true, checked: sessions.length, reset };
}
