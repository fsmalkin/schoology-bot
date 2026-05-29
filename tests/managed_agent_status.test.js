import test from "node:test";
import assert from "node:assert/strict";
import {
  createDb,
  recordManagedAgentEvent,
  upsertManagedAgentSession,
} from "../src/db.js";
import {
  buildManagedAgentStatus,
  resetIdleManagedAgentSessions,
  sanitizeManagedAgentEventMetadata,
  shouldResetManagedSessionForIdle,
} from "../src/managed_agent_status.js";

function makeConfig() {
  return {
    managedAgents: {
      enabled: true,
      environment: "dev",
      sessionNamespace: "schoology-dev",
      sessionTtlMinutes: 60,
      idleTimeoutMinutes: 10,
    },
    runtime: { stack: "managed-agents" },
  };
}

test("managed agent idle policy resets active sessions after the idle timeout", () => {
  const session = {
    status: "active",
    isExpired: false,
    createdAt: "2026-05-28T12:00:00.000Z",
    updatedAt: "2026-05-28T12:00:00.000Z",
    lastEventAt: "2026-05-28T12:00:00.000Z",
  };

  const within = shouldResetManagedSessionForIdle(
    session,
    { idleTimeoutMinutes: 10 },
    "2026-05-28T12:09:59.000Z"
  );
  assert.equal(within.reset, false);
  assert.equal(within.reason, "within_idle_timeout");

  const expired = shouldResetManagedSessionForIdle(
    session,
    { idleTimeoutMinutes: 10 },
    "2026-05-28T12:10:00.000Z"
  );
  assert.equal(expired.reset, true);
  assert.equal(expired.reason, "idle_timeout");
  assert.equal(expired.timeoutMinutes, 10);
});

test("managed agent event metadata sanitizer redacts secret-like keys", () => {
  const sanitized = sanitizeManagedAgentEventMetadata({
    toolName: "web_search",
    apiKey: "secret-value",
    nested: {
      authorization: "Bearer secret",
      message: "password is much10600 and token=abc12345",
      safe: "x".repeat(400),
    },
  });

  assert.equal(sanitized.toolName, "web_search");
  assert.equal(sanitized.apiKey, "[redacted]");
  assert.equal(sanitized.nested.authorization, "[redacted]");
  assert.equal(sanitized.nested.message, "password [redacted] and token=[redacted]");
  assert.equal(sanitized.nested.safe.length, 303);
});

test("managed agent status builder reports sessions, events, and alerts", () => {
  const db = createDb();
  upsertManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "schoology-dev",
    sessionId: "sesn_1234567890abcdef",
    createdAt: "2026-05-28T12:00:00.000Z",
    updatedAt: "2026-05-28T12:00:00.000Z",
    lastEventAt: "2026-05-28T12:00:00.000Z",
    expiresAt: "2026-05-28T13:00:00.000Z",
    metadata: { lastEventType: "telegram_message", createReason: "missing" },
  });
  recordManagedAgentEvent(db, {
    chatId: "chat-1",
    environment: "schoology-dev",
    sessionId: "sesn_1234567890abcdef",
    eventType: "turn_error",
    status: "error",
    summary: "Claude Managed Agents stream timed out.",
    metadata: { errorMessage: "timed out" },
    createdAt: "2026-05-28T12:11:00.000Z",
  });

  const status = buildManagedAgentStatus({
    db,
    config: makeConfig(),
    now: new Date("2026-05-28T12:11:00.000Z"),
  });

  assert.equal(status.enabled, true);
  assert.equal(status.environment, "schoology-dev");
  assert.equal(status.activeSessionCount, 1);
  assert.equal(status.latestSession.idleExpired, true);
  assert.equal(status.recentEvents[0].eventType, "turn_error");
  assert.equal(status.recentEvents[0].status, "error");
  assert.ok(status.alerts.some((alert) => alert.severity === "error"));
  assert.ok(status.alerts.some((alert) => alert.severity === "warning"));
});

test("managed agent status builder flags repeated tool errors", () => {
  const db = createDb();
  for (let i = 0; i < 3; i += 1) {
    recordManagedAgentEvent(db, {
      chatId: "chat-1",
      environment: "schoology-dev",
      sessionId: "sesn_tool_errors",
      eventType: "custom_tool_result",
      status: "error",
      summary: `Tool failed ${i}`,
      metadata: { toolName: "list_assignments", error: "bad args" },
      createdAt: `2026-05-28T12:1${i}:00.000Z`,
    });
  }

  const status = buildManagedAgentStatus({
    db,
    config: makeConfig(),
    now: new Date("2026-05-28T12:20:00.000Z"),
  });

  assert.ok(status.alerts.some((alert) => /Repeated managed tool errors/.test(alert.message)));
});

test("managed agent idle sweep resets expired-idle sessions and records an event", () => {
  const db = createDb();
  upsertManagedAgentSession(db, {
    chatId: "chat-idle",
    environment: "schoology-dev",
    sessionId: "sesn_idle",
    createdAt: "2026-05-28T12:00:00.000Z",
    updatedAt: "2026-05-28T12:00:00.000Z",
    lastEventAt: "2026-05-28T12:00:00.000Z",
    expiresAt: "2026-05-28T13:00:00.000Z",
  });

  const result = resetIdleManagedAgentSessions({
    db,
    config: makeConfig(),
    now: new Date("2026-05-28T12:11:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checked, 1);
  assert.equal(result.reset, 1);

  const status = buildManagedAgentStatus({
    db,
    config: makeConfig(),
    now: new Date("2026-05-28T12:11:00.000Z"),
  });
  assert.equal(status.activeSessionCount, 0);
  assert.equal(status.recentEvents[0].eventType, "session_idle_reset");
});
