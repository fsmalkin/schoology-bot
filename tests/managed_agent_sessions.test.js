import test from "node:test";
import assert from "node:assert/strict";
import {
  createDb,
  getManagedAgentSession,
  getOrCreateManagedAgentSession,
  markManagedAgentSessionEvent,
  resetManagedAgentSession,
  upsertManagedAgentSession,
} from "../src/db.js";
import { buildManagedAgentsConfig, validateManagedAgentsConfig } from "../src/config.js";

test("managed agents config defaults are disabled and dev-scoped", () => {
  const config = buildManagedAgentsConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.environment, "dev");
  assert.equal(config.apiKey, "");
  assert.equal(config.agentId, "");
  assert.equal(config.betaHeader, "managed-agents-2026-04-01");
  assert.equal(config.sessionTtlMinutes, 1440);
  assert.equal(config.idleTimeoutMinutes, 30);
});

test("managed agents config reads explicit dev runtime values", () => {
  const config = buildManagedAgentsConfig({
    MANAGED_AGENTS_ENABLED: "1",
    MANAGED_AGENTS_ENV: "dev",
    ANTHROPIC_API_KEY: "secret",
    CLAUDE_MANAGED_AGENT_ID: "agent_123",
    CLAUDE_MANAGED_ENVIRONMENT_ID: "env_123",
    MANAGED_AGENT_SESSION_TTL_MINUTES: "60",
    MANAGED_AGENT_IDLE_TIMEOUT_MINUTES: "10",
    MANAGED_AGENT_STREAM_TIMEOUT_MS: "5000",
    MANAGED_AGENT_MAX_TOOL_ROUNDS: "3",
    MANAGED_AGENT_TOOL_RESULT_MAX_CHARS: "4000",
    MANAGED_AGENT_SESSION_NAMESPACE: "schoology-dev",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.environment, "dev");
  assert.equal(config.apiKey, "secret");
  assert.equal(config.agentId, "agent_123");
  assert.equal(config.environmentId, "env_123");
  assert.equal(config.sessionTtlMinutes, 60);
  assert.equal(config.idleTimeoutMinutes, 10);
  assert.equal(config.streamTimeoutMs, 5000);
  assert.equal(config.maxToolRounds, 3);
  assert.equal(config.toolResultMaxChars, 4000);
  assert.equal(config.sessionNamespace, "schoology-dev");
  assert.doesNotThrow(() => validateManagedAgentsConfig({ managedAgents: config }));
});

test("managed agents validation requires API key and agent id only when enabled", () => {
  assert.doesNotThrow(() =>
    validateManagedAgentsConfig({ managedAgents: buildManagedAgentsConfig({}) })
  );

  assert.throws(
    () =>
      validateManagedAgentsConfig({
        managedAgents: buildManagedAgentsConfig({ MANAGED_AGENTS_ENABLED: "true" }),
      }),
    /ANTHROPIC_API_KEY, CLAUDE_MANAGED_AGENT_ID, CLAUDE_MANAGED_ENVIRONMENT_ID/
  );
});

test("managed agent session mapping creates and reuses active session", () => {
  const db = createDb();
  let created = 0;

  const first = getOrCreateManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "dev",
    now: "2026-05-26T00:00:00.000Z",
    ttlMinutes: 60,
    metadata: { source: "test" },
    createSessionId: ({ reason }) => {
      created += 1;
      assert.equal(reason, "missing");
      return "sess_1";
    },
  });

  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.session.sessionId, "sess_1");
  assert.equal(first.session.environment, "dev");
  assert.equal(first.session.expiresAt, "2026-05-26T01:00:00.000Z");
  assert.equal(first.session.metadata.source, "test");
  assert.equal(first.session.metadata.createReason, "missing");

  const second = getOrCreateManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "dev",
    now: "2026-05-26T00:30:00.000Z",
    createSessionId: () => {
      throw new Error("should not create");
    },
  });

  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.reason, "existing");
  assert.equal(second.session.sessionId, "sess_1");
  assert.equal(created, 1);
});

test("managed agent session mapping replaces expired and reset sessions", () => {
  const db = createDb();
  upsertManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "dev",
    sessionId: "sess_old",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    expiresAt: "2026-05-26T00:10:00.000Z",
  });

  const expired = getOrCreateManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "dev",
    now: "2026-05-26T00:11:00.000Z",
    ttlMinutes: 30,
    createSessionId: ({ previousSession, reason }) => {
      assert.equal(reason, "expired");
      assert.equal(previousSession.sessionId, "sess_old");
      return "sess_new";
    },
  });

  assert.equal(expired.created, true);
  assert.equal(expired.session.sessionId, "sess_new");
  assert.equal(expired.session.metadata.previousSessionId, "sess_old");

  const reset = resetManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "dev",
    resetAt: "2026-05-26T00:12:00.000Z",
    reason: "user-requested",
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.reset, 1);
  assert.equal(reset.session.status, "reset");
  assert.equal(reset.session.metadata.resetReason, "user-requested");

  const recreated = getOrCreateManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "dev",
    now: "2026-05-26T00:13:00.000Z",
    createSessionId: ({ reason }) => {
      assert.equal(reason, "reset");
      return "sess_after_reset";
    },
  });
  assert.equal(recreated.created, true);
  assert.equal(recreated.session.sessionId, "sess_after_reset");
});

test("managed agent session event updates last event and metadata", () => {
  const db = createDb();
  upsertManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "prod",
    sessionId: "sess_prod",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    metadata: { source: "seed" },
  });

  const updated = markManagedAgentSessionEvent(db, {
    chatId: "chat-1",
    environment: "prod",
    lastEventAt: "2026-05-26T00:15:00.000Z",
    metadata: { lastEventType: "assistant_response" },
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.session.lastEventAt, "2026-05-26T00:15:00.000Z");
  assert.equal(updated.session.metadata.source, "seed");
  assert.equal(updated.session.metadata.lastEventType, "assistant_response");

  const stored = getManagedAgentSession(db, "chat-1", "prod");
  assert.equal(stored.sessionId, "sess_prod");
  assert.equal(stored.metadata.lastEventType, "assistant_response");
});
