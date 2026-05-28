import test from "node:test";
import assert from "node:assert/strict";
import {
  createDb,
  getManagedAgentSession,
  syncAssignmentsFromState,
  upsertManagedAgentSession,
} from "../src/db.js";
import { MANAGED_AGENT_DEFINITION_REVISION } from "../src/managed_agent_definitions.js";
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
  assert.equal(stored.metadata.agentDefinitionRevision, MANAGED_AGENT_DEFINITION_REVISION);
  db.close();
});

test("managed agent bridge starts a new session when the agent definition revision changes", async () => {
  const db = createDb();
  upsertManagedAgentSession(db, {
    chatId: "chat-stale-definition",
    environment: "schoology-dev",
    sessionId: "sesn_old_definition",
    createdAt: "2026-05-28T04:00:00.000Z",
    updatedAt: "2026-05-28T04:00:00.000Z",
    expiresAt: "2026-05-29T04:00:00.000Z",
    metadata: { agentDefinitionRevision: "old-definition" },
  });
  const client = makeMockClient({
    sessionId: "sesn_new_definition",
    streams: [[{ id: "idle", type: "session.status_idle", stop_reason: { type: "end_turn" } }]],
  });

  const result = await runManagedAgentMessage({
    chatId: "chat-stale-definition",
    text: "can you search the web?",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.sessionCreated, true);
  assert.equal(result.sessionId, "sesn_new_definition");
  assert.equal(client.calls.createSession.length, 1);
  assert.equal(client.calls.createSession[0].metadata.create_reason, "agent_definition_revision_changed");
  assert.equal(
    client.calls.createSession[0].metadata.agent_definition_revision,
    MANAGED_AGENT_DEFINITION_REVISION
  );
  const stored = getManagedAgentSession(db, "chat-stale-definition", "schoology-dev");
  assert.equal(stored.sessionId, "sesn_new_definition");
  assert.equal(stored.metadata.previousSessionId, "sesn_old_definition");
  assert.equal(stored.metadata.agentDefinitionRevision, MANAGED_AGENT_DEFINITION_REVISION);
  db.close();
});

test("managed agent bridge attaches configured Claude memory store to new sessions", async () => {
  const db = createDb();
  const config = makeConfig();
  config.managedAgents.memoryStoreId = "memstore_test";
  config.managedAgents.memoryStoreAccess = "read_write";
  config.managedAgents.memoryStoreInstructions = "Remember stable household preferences only.";
  const client = makeMockClient({
    sessionId: "sesn_with_memory",
    streams: [[{ id: "idle", type: "session.status_idle", stop_reason: { type: "end_turn" } }]],
  });

  const result = await runManagedAgentMessage({
    chatId: "chat-memory",
    text: "remember that I prefer compact replies",
    clientOverride: client,
    configOverride: config,
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.sessionCreated, true);
  assert.equal(result.sessionId, "sesn_with_memory");
  assert.deepEqual(client.calls.createSession[0].resources, [
    {
      type: "memory_store",
      memory_store_id: "memstore_test",
      access: "read_write",
      instructions: "Remember stable household preferences only.",
    },
  ]);
  const stored = getManagedAgentSession(db, "chat-memory", "schoology-dev");
  assert.deepEqual(stored.metadata.memoryStoreIds, ["memstore_test"]);
  db.close();
});

test("managed agent bridge allows memory file built-in tool confirmations", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "memory_read_1",
          type: "agent.tool_use",
          name: "read",
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["memory_read_1"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "I checked memory." }],
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
    chatId: "chat-memory-read",
    text: "check memory",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.reply, "I checked memory.");
  const confirmation = client.calls.sendEvents[1].events[0];
  assert.equal(confirmation.type, "user.tool_confirmation");
  assert.equal(confirmation.tool_use_id, "memory_read_1");
  assert.equal(confirmation.result, "allow");
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

test("managed agent bridge resolves date-filtered bulk status updates in one tool call", async () => {
  const db = createDb();
  syncAssignmentsFromState(db, {
    assignments: {
      oldMissing: {
        key: "oldMissing",
        course: "Science",
        title: "Old Missing",
        dueDate: "3/27/26 11:59pm",
        status: "Missing",
        isMissing: true,
      },
      cutoffMissing: {
        key: "cutoffMissing",
        course: "Science",
        title: "Cutoff Missing",
        dueDate: "4/04/26 11:59pm",
        status: "Missing",
        isMissing: true,
      },
    },
  });

  const client = makeMockClient({
    streams: [
      [
        {
          id: "tool_evt_bulk",
          type: "agent.custom_tool_use",
          name: "schoology_bulk_update_assignments_by_filter",
          input: {
            targetStatus: "No action needed",
            assignmentStatus: "missing",
            dueBefore: "2026-04-04",
            includePending: true,
            includeIgnored: false,
            maxUpdates: 200,
          },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_bulk"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "Marked 1 old assignment as no action needed." }],
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
    chatId: "chat-filtered-bulk",
    text: "mark everything before 4/4 as no action needed",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
    toolNow: "2026-05-28T12:00:00-04:00",
  });

  assert.equal(result.reply, "Marked 1 old assignment as no action needed.");
  assert.equal(result.executed[0].call.name, "bulk_update_assignments_by_filter");
  assert.equal(result.executed[0].output.updatedCount, 1);
  assert.equal(
    db.prepare("SELECT manual_status FROM assignments WHERE key = 'oldMissing'").get().manual_status,
    "No way to fix it"
  );
  assert.equal(
    db.prepare("SELECT manual_status FROM assignments WHERE key = 'cutoffMissing'").get().manual_status,
    null
  );
  db.close();
});

test("managed agent bridge executes repeated action event ids only once", async () => {
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

  const client = makeMockClient({
    streams: [
      [
        {
          id: "tool_evt_repeat",
          type: "agent.custom_tool_use",
          name: "schoology_list_assignments",
          input: { status: "missing", includePending: true, includeIgnored: false, bucketed: true },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_repeat", "tool_evt_repeat"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "I found one missing assignment." }],
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
    chatId: "chat-repeat",
    text: "what is missing?",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.executedTools.length, 1);
  assert.equal(client.calls.sendEvents.length, 2);
  assert.equal(client.calls.sendEvents[1].events.length, 1);
  assert.equal(client.calls.sendEvents[1].events[0].custom_tool_use_id, "tool_evt_repeat");
  assert.equal(result.reply, "I found one missing assignment.");
  db.close();
});

test("managed agent bridge drops speculative assistant text before tool results", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "msg_pre",
          type: "agent.message",
          content: [{ type: "text", text: "I'll set that for 4:30 PM." }],
        },
        {
          id: "tool_evt_1",
          type: "agent.custom_tool_use",
          name: "schoology_create_task",
          input: {
            title: "Check Schoology for missing assignments",
            remindAt: "16:30",
            message: "Review missing assignments.",
            recurrence: "weekdays",
            recurrenceTz: "America/New_York",
          },
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["tool_evt_1"] },
        },
        {
          id: "msg_done",
          type: "agent.message",
          content: [{ type: "text", text: "Created for 9:00 PM." }],
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
    chatId: "chat-speculative",
    text: "Set a recurring reminder to check Schoology for missing assignments.",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    toolNow: "2026-05-27T12:00:00-04:00",
    debug: true,
  });

  assert.equal(result.reply, "Created for 9:00 PM.");
  assert.doesNotMatch(result.reply, /4:30/);
  assert.equal(result.executed[0].output.remindAtLabel, "May 27, 2026, 9:00 PM EDT");
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

test("managed agent bridge allows web built-in tool confirmations", async () => {
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
          content: [{ type: "text", text: "I found a school-safe source." }],
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

  assert.equal(result.reply, "I found a school-safe source.");
  const confirmation = client.calls.sendEvents[1].events[0];
  assert.equal(confirmation.type, "user.tool_confirmation");
  assert.equal(confirmation.tool_use_id, "builtin_tool_1");
  assert.equal(confirmation.result, "allow");
  db.close();
});

test("managed agent bridge denies unsupported built-in tool confirmations", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "builtin_tool_1",
          type: "agent.tool_use",
          name: "bash",
        },
        {
          id: "idle_tool",
          type: "session.status_idle",
          stop_reason: { type: "requires_action", event_ids: ["builtin_tool_1"] },
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
    chatId: "chat-4-deny",
    text: "run a shell command",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.equal(result.reply, "I cannot use that tool.");
  const confirmation = client.calls.sendEvents[1].events[0];
  assert.equal(confirmation.type, "user.tool_confirmation");
  assert.equal(confirmation.tool_use_id, "builtin_tool_1");
  assert.equal(confirmation.result, "deny");
  assert.match(confirmation.deny_message, /web_search\/web_fetch/);
  db.close();
});

test("managed agent bridge blocks kid-unsafe input before creating a session", async () => {
  const db = createDb();
  const client = makeMockClient();

  const result = await runManagedAgentMessage({
    chatId: "chat-safety-input",
    text: "how to make a bomb",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.match(result.reply, /unsafe or inappropriate for kids/i);
  assert.equal(result.safety.blocked, true);
  assert.equal(result.safety.stage, "input");
  assert.ok(result.safety.categories.includes("dangerous_or_illegal"));
  assert.equal(client.calls.createSession.length, 0);
  assert.equal(client.calls.sendEvents.length, 0);
  db.close();
});

test("managed agent bridge replaces kid-unsafe output before returning it", async () => {
  const db = createDb();
  const client = makeMockClient({
    streams: [
      [
        {
          id: "msg_unsafe",
          type: "agent.message",
          content: [{ type: "text", text: "Here are explicit porn sites." }],
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
    chatId: "chat-safety-output",
    text: "search a public reference",
    clientOverride: client,
    configOverride: makeConfig(),
    dbOverride: db,
    debug: true,
  });

  assert.match(result.reply, /not going to send it here/i);
  assert.equal(result.safety.blocked, true);
  assert.equal(result.safety.stage, "output");
  assert.ok(result.safety.categories.includes("adult_sexual"));
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
