import test from "node:test";
import assert from "node:assert/strict";
import { createDb, getManagedAgentSession, syncAssignmentsFromState } from "../src/db.js";
import { runManagedAgentMessage } from "../src/managed_agent_bridge.js";

function makeConfig() {
  return {
    managedAgents: {
      enabled: true,
      environment: "dev",
      apiKey: "test-key",
      agentId: "agent_test",
      environmentId: "env_test",
      baseUrl: "https://api.anthropic.test",
      betaHeader: "managed-agents-2026-04-01",
      sessionTtlMinutes: 60,
      idleTimeoutMinutes: 10,
      streamTimeoutMs: 5000,
      maxToolRounds: 4,
      toolResultMaxChars: 20000,
      sessionNamespace: "schoology-dev",
    },
    runtime: { stack: "managed-agents" },
    paths: { statePath: "__missing_state_for_test__.json" },
  };
}

function makeMockClient({ sessionId = "sesn_test", streams = [] } = {}) {
  const calls = {
    createSession: [],
    sendEvents: [],
    streamEvents: [],
  };
  const streamQueue = streams.map((stream) => [...stream]);
  return {
    calls,
    createSession: async (payload) => {
      calls.createSession.push(payload);
      return { id: sessionId, status: "idle" };
    },
    sendEvents: async (id, events) => {
      calls.sendEvents.push({ sessionId: id, events });
      return { ok: true };
    },
    streamEvents: async function* (id) {
      calls.streamEvents.push({ sessionId: id });
      const next = streamQueue.shift() || [];
      for (const event of next) {
        yield event;
      }
    },
  };
}

test("managed agent bridge creates a session, sends Telegram text, and returns agent message", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "evt_msg_1",
          type: "agent.message",
          content: [{ type: "text", text: "Hello from Claude." }],
        },
        {
          id: "evt_idle_1",
          type: "session.status_idle",
          stop_reason: { type: "end_turn" },
        },
      ],
    ],
  });

  const result = await runManagedAgentMessage({
    chatId: "chat-1",
    text: "ping",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.reply, "Hello from Claude.");
  assert.equal(result.sessionId, "sesn_test");
  assert.equal(result.sessionCreated, true);
  assert.equal(client.calls.createSession.length, 1);
  assert.equal(client.calls.sendEvents[0].events[0].type, "user.message");
  assert.equal(client.calls.sendEvents[0].events[0].content[0].text, "ping");

  const stored = getManagedAgentSession(db, "chat-1", "schoology-dev");
  assert.equal(stored.sessionId, "sesn_test");
  assert.equal(stored.metadata.environmentId, "env_test");
  db.close();
});

test("managed agent bridge reuses a session and resolves custom Schoology tool calls", async () => {
  const db = createDb();
  syncAssignmentsFromState(db, {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "Homework 1",
        dueDate: "2026-01-05",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-05T00:00:00Z",
        lastSeenAt: "2026-01-05T01:00:00Z",
        lastMissingAt: "2026-01-05T01:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });

  const firstClient = makeMockClient({
    sessionId: "sesn_existing",
    streams: [[{ id: "idle", type: "session.status_idle", stop_reason: { type: "end_turn" } }]],
  });
  await runManagedAgentMessage({
    chatId: "chat-2",
    text: "start",
    clientOverride: firstClient,
    configOverride: makeConfig(),
    dbOverride: db,
  });

  const client = makeMockClient({
    sessionId: "sesn_should_not_create",
    streams: [
      [
        {
          id: "tool_evt_1",
          type: "agent.custom_tool_use",
          name: "schoology.list_assignments",
          input: { status: "missing", includePending: true, includeIgnored: false, bucketed: true },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_1"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "Missing assignments: Algebra Homework 1." }],
        },
        {
          id: "idle_done",
          type: "session.status_idle",
          stop_reason: { type: "end_turn" },
        },
      ],
    ],
  });

  const result = await runManagedAgentMessage({
    chatId: "chat-2",
    text: "what is missing?",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.sessionCreated, false);
  assert.equal(result.sessionId, "sesn_existing");
  assert.equal(result.executedTools.length, 1);
  assert.equal(result.executed[0].call.name, "list_assignments");
  assert.equal(result.executed[0].output.ok, true);
  assert.equal(result.reply, "Missing assignments: Algebra Homework 1.");
  assert.equal(client.calls.createSession.length, 0);
  assert.equal(client.calls.sendEvents.length, 2);
  const toolResultEvent = client.calls.sendEvents[1].events[0];
  assert.equal(toolResultEvent.type, "user.custom_tool_result");
  assert.equal(toolResultEvent.custom_tool_use_id, "tool_evt_1");
  assert.match(toolResultEvent.content[0].text, /Homework 1/);
  db.close();
});

test("managed agent bridge returns unsupported custom tool errors without hanging", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "tool_unknown",
          type: "agent.custom_tool_use",
          name: "schoology.delete_everything",
          input: {},
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_unknown"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "I cannot use that tool." }],
        },
        {
          id: "idle_done",
          type: "session.status_idle",
          stop_reason: { type: "end_turn" },
        },
      ],
    ],
  });

  const result = await runManagedAgentMessage({
    chatId: "chat-3",
    text: "delete everything",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.reply, "I cannot use that tool.");
  const toolResult = JSON.parse(client.calls.sendEvents[1].events[0].content[0].text);
  assert.equal(toolResult.ok, false);
  assert.match(toolResult.error, /Unsupported Schoology tool/);
  db.close();
});

test("managed agent bridge denies non-custom tool confirmations", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "builtin_tool_1",
          type: "agent.tool_use",
          name: "web_search",
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["builtin_tool_1"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "I need the local tools instead." }],
        },
        {
          id: "idle_done",
          type: "session.status_idle",
          stop_reason: { type: "end_turn" },
        },
      ],
    ],
  });

  const result = await runManagedAgentMessage({
    chatId: "chat-4",
    text: "search the web",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.reply, "I need the local tools instead.");
  const confirmation = client.calls.sendEvents[1].events[0];
  assert.equal(confirmation.type, "user.tool_confirmation");
  assert.equal(confirmation.tool_use_id, "builtin_tool_1");
  assert.equal(confirmation.result, "deny");
  db.close();
});

test("managed agent bridge bounds large custom tool results", async () => {
  const db = createDb();
  syncAssignmentsFromState(db, {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "Homework 1",
        dueDate: "2026-01-05",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "x".repeat(500),
        firstSeenAt: "2026-01-05T00:00:00Z",
        lastSeenAt: "2026-01-05T01:00:00Z",
        lastMissingAt: "2026-01-05T01:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });
  const config = makeConfig();
  config.managedAgents.toolResultMaxChars = 120;
  const client = makeMockClient({
    streams: [
      [
        {
          id: "tool_evt_1",
          type: "agent.custom_tool_use",
          name: "list_assignments",
          input: { status: "missing", includePending: true, includeIgnored: true, bucketed: false },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_1"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "I found a large result." }],
        },
        {
          id: "idle_done",
          type: "session.status_idle",
          stop_reason: { type: "end_turn" },
        },
      ],
    ],
  });

  await runManagedAgentMessage({
    chatId: "chat-5",
    text: "list missing",
    clientOverride: client,
    configOverride: config,
    dbOverride: db,
  });

  const payload = JSON.parse(client.calls.sendEvents[1].events[0].content[0].text);
  assert.equal(payload.truncated, true);
  assert.ok(payload.originalLength > 120);
  assert.equal(payload.preview.length, 120);
  db.close();
});

test("managed agent bridge returns deterministic tool errors for invalid args", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "tool_evt_1",
          type: "agent.custom_tool_use",
          name: "update_assignment_status",
          input: { status: "C" },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_1"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "Which assignment should I update?" }],
        },
        {
          id: "idle_done",
          type: "session.status_idle",
          stop_reason: { type: "end_turn" },
        },
      ],
    ],
  });

  await runManagedAgentMessage({
    chatId: "chat-6",
    text: "mark it complete",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
  });

  const payload = JSON.parse(client.calls.sendEvents[1].events[0].content[0].text);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Could not find assignment|multiple matches|required/i);
  db.close();
});

test("managed agent bridge enforces custom tool round limits", async () => {
  const db = createDb();
  const config = makeConfig();
  config.managedAgents.maxToolRounds = 1;
  const client = makeMockClient({
    streams: [
      [
        {
          id: "tool_evt_1",
          type: "agent.custom_tool_use",
          name: "list_assignments",
          input: { status: "missing", includePending: true, includeIgnored: false },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_1"] },
        },
      ],
    ],
  });

  await assert.rejects(
    () =>
      runManagedAgentMessage({
        chatId: "chat-7",
        text: "list missing forever",
        clientOverride: client,
        configOverride: config,
        dbOverride: db,
      }),
    /tool round limit/
  );
  assert.equal(client.calls.sendEvents.length, 2);
  db.close();
});
