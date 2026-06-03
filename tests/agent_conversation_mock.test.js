import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "agent_mock_test.db");

function createMockClient(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    responses: {
      create: async (payload) => {
        calls.push(payload);
        if (queue.length === 0) {
          throw new Error("Mock responses exhausted");
        }
        return queue.shift();
      },
    },
  };
}

function textResponse(id, text) {
  return { id, output_text: text };
}

function functionCallResponse(id, name, args, callId) {
  return {
    id,
    output: [
      {
        type: "function_call",
        name,
        arguments: JSON.stringify(args || {}),
        call_id: callId || `call_${id}`,
      },
    ],
  };
}

function pendingDecisionResponse(id, action = "proceed") {
  return {
    id,
    output_text: JSON.stringify({ action, reason: "Pending decision" }),
  };
}

function seedState() {
  return {
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
      a2: {
        key: "a2",
        course: "Latin",
        title: "Quiz 1",
        dueDate: "2026-01-06",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-06T00:00:00Z",
        lastSeenAt: "2026-01-06T01:00:00Z",
        lastMissingAt: "2026-01-06T01:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a3: {
        key: "a3",
        course: "Science",
        title: "Lab 1",
        dueDate: "2026-01-07",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-07T00:00:00Z",
        lastSeenAt: "2026-01-07T01:00:00Z",
        lastMissingAt: "2026-01-07T01:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a4: {
        key: "a4",
        course: "Science",
        title: "Lab 2",
        dueDate: "2026-01-08",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-08T00:00:00Z",
        lastSeenAt: "2026-01-08T01:00:00Z",
        lastMissingAt: "2026-01-08T01:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  };
}

async function cleanupDb() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      return;
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Failed to delete ${dbPath}`);
}

test("agent conversation cases (mock)", async () => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "200";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "0";
  process.env.OPENAI_CAPABILITY_GUARD = "0";
  process.env.AGENT_DB_PATH = dbPath;

  const {
    createDb,
    syncAssignmentsFromState,
    getDb,
    closeDb,
    listAssignments,
    getPendingAction,
    setPendingAction,
    setConversationContext,
  } = await import("../src/db.js");
  const { getConfig } = await import("../src/config.js");
  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  syncAssignmentsFromState(db, seedState());
  db.close();

  const mockList = createMockClient([
    functionCallResponse(
      "r0",
      "list_assignments",
      {
        status: "missing",
        course: null,
        limit: 1000,
        includeIgnored: false,
        includePending: true,
        bucketed: true,
      },
      "call_list_0"
    ),
    textResponse("r1", "Missing assignments: Algebra Homework 1; Latin Quiz 1; Science Lab 1; Science Lab 2."),
  ]);

  const chatId = `chat-mock-${Date.now()}`;
  const reply1 = await runAgentMessage({ chatId, text: "What is missing?", clientOverride: mockList });
  assert.match(reply1, /Missing assignments/i);
  assert.equal(mockList.calls.length, 2);

  const mockUpdate = createMockClient([
    functionCallResponse(
      "r2",
      "apply_numbered_statuses",
      {
        listStatus: "missing",
        statusByIndex: [
          { index: 1, status: "C" },
          { index: 2, status: "B" },
          { index: 3, status: "D" },
          { index: 4, status: "E" },
        ],
      },
      "call_apply_0"
    ),
    textResponse(
      "r3",
      "Updating now.\nDone.\nUpdating now.\nDone.\nUpdating now.\nDone.\nUpdating now."
    ),
  ]);

  const reply2 = await runAgentMessage({ chatId, text: "1 C, 2 B, 3 D, 4 E", clientOverride: mockUpdate });
  assert.match(reply2, /Do Now/i);
  assert.match(reply2, /Waiting/i);
  assert.doesNotMatch(reply2, /Updating now/i);
  assert.equal(mockUpdate.calls[0].previous_response_id, "r1");

  const dbLive = getDb(getConfig());
  const allRows = listAssignments(dbLive, {
    status: "missing",
    includeIgnored: true,
    includePending: true,
    limit: 10,
  });
  const statusByKey = new Map(allRows.map((row) => [row.key, row.manualStatus]));
  assert.equal(statusByKey.get("a1"), "No way to fix it");
  assert.equal(statusByKey.get("a2"), "Practice / not for grade");
  assert.equal(statusByKey.get("a3"), "No grade put in yet");
  assert.equal(statusByKey.get("a4"), "Waiting on teacher");

  const mockClarify = createMockClient([
    textResponse("r4", "Which assignment did you mean?"),
  ]);
  const reply3 = await runAgentMessage({ chatId, text: "Mark Lab as B", clientOverride: mockClarify });
  assert.equal(reply3, "Which assignment did you mean?");

  const mockPending1 = createMockClient([
    functionCallResponse(
      "r5",
      "update_assignment_status",
      { key: null, title: "Lab", course: null, status: "C" },
      "call_update_0"
    ),
    textResponse("r6", "Which Lab did you mean?"),
  ]);

  const reply4 = await runAgentMessage({ chatId, text: "Mark Lab as C", clientOverride: mockPending1 });
  assert.match(reply4, /Which Lab/i);
  const pending = getPendingAction(getDb(getConfig()), chatId);
  assert.ok(pending);
  assert.equal(pending.tool, "update_assignment_status");
  assert.equal(pending.args.status, "C");

  const mockPending2 = createMockClient([
    pendingDecisionResponse("r7", "proceed"),
    functionCallResponse("r8", "update_assignment_status", { key: null, title: "Lab 1", course: null }, "call_update_1"),
    textResponse("r9", "Updated."),
  ]);
  const reply5 = await runAgentMessage({ chatId, text: "Lab 1", clientOverride: mockPending2 });
  assert.match(reply5, /Updated/i);
  const pendingAfter = getPendingAction(getDb(getConfig()), chatId);
  assert.equal(pendingAfter, null);

  const mockConfirm = createMockClient([
    functionCallResponse("r10", "schedule_reminder", {}, "call_reminder_0"),
    textResponse("r11", ""),
  ]);

  setPendingAction(getDb(getConfig()), {
    chatId,
    tool: "schedule_reminder",
    args: { key: "a1", remindAt: "2026-02-03T20:30:00Z", message: "Follow up" },
  });

  const reply6 = await runAgentMessage({ chatId, text: "Go", clientOverride: mockConfirm });
  assert.match(reply6, /Saved reminder/i);
  const pendingAfterConfirm = getPendingAction(getDb(getConfig()), chatId);
  assert.equal(pendingAfterConfirm, null);

  const mockInvalidPending = createMockClient([
    textResponse("r12", "Which assignment did you mean? Paste the assignment link or title and I'll do it."),
  ]);

  // Malformed pending action: missing key/title selector, which would otherwise loop on "Go".
  setPendingAction(getDb(getConfig()), {
    chatId,
    tool: "add_assignment_note",
    args: { key: null, title: null, course: null, note: "Submitted. Waiting for grade." },
    note: "Assignment key or title is required.",
  });

  const reply7 = await runAgentMessage({ chatId, text: "Go", clientOverride: mockInvalidPending });
  assert.match(reply7, /Which assignment/i);
  const pendingAfterInvalid = getPendingAction(getDb(getConfig()), chatId);
  assert.equal(pendingAfterInvalid, null);

  setConversationContext(getDb(getConfig()), {
    chatId,
    type: "last_displayed_assignment_list",
    payload: {
      source: "assistant_reply",
      items: [
        {
          index: 2,
          key: "assignment:8386979006",
          title: "Lab: MAGLEY Review",
          course: "Science",
          status: "Submitted",
        },
      ],
    },
  });
  const mockContext = createMockClient([
    textResponse("r13", "I see #2 is Lab: MAGLEY Review."),
  ]);
  const reply8 = await runAgentMessage({
    chatId,
    text: "No number 2, the MAGLEY assignment",
    clientOverride: mockContext,
  });
  assert.match(reply8, /MAGLEY/);
  assert.match(String(mockContext.calls[0].input || ""), /Short-lived current-thread context/);
  assert.match(String(mockContext.calls[0].input || ""), /assignment:8386979006/);

  closeDb();
  await cleanupDb();
});
