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

function toolCallResponse(id, name, args) {
  return {
    id,
    output: [
      {
        type: "function_call",
        name,
        arguments: JSON.stringify(args || {}),
        call_id: `${id}-call`,
      },
    ],
  };
}

function textResponse(id, text) {
  return { id, output_text: text };
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
  process.env.AGENT_DB_PATH = dbPath;

  const { createDb, syncAssignmentsFromState, getDb, closeDb, listAssignments } = await import("../src/db.js");
  const { getConfig } = await import("../src/config.js");
  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  syncAssignmentsFromState(db, seedState());
  db.close();

  const mockList = createMockClient([
    toolCallResponse("r1", "list_assignments", { status: "missing", bucketed: true }),
    textResponse("r2", "Missing assignments: Algebra Homework 1; Latin Quiz 1; Science Lab 1; Science Lab 2."),
  ]);

  const chatId = `chat-mock-${Date.now()}`;
  const reply1 = await runAgentMessage({ chatId, text: "What is missing?", clientOverride: mockList });
  assert.match(reply1, /Missing assignments/i);
  assert.equal(mockList.calls.length, 2);

  const mockUpdate = createMockClient([
    toolCallResponse("r3", "apply_numbered_statuses", {
      statusByIndex: [
        { index: 1, status: "C" },
        { index: 2, status: "B" },
        { index: 3, status: "D" },
        { index: 4, status: "E" },
      ],
    }),
    textResponse(
      "r4",
      "Updating now.\nDone.\nUpdating now.\nDone.\nUpdating now.\nDone.\nUpdating now."
    ),
  ]);

  const reply2 = await runAgentMessage({ chatId, text: "1 C, 2 B, 3 D, 4 E", clientOverride: mockUpdate });
  assert.match(reply2, /Updates applied/i);
  assert.match(reply2, /Follow-up needed/i);
  assert.doesNotMatch(reply2, /Updating now/i);

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
    textResponse("r5", "Which assignment did you mean?"),
  ]);
  const reply3 = await runAgentMessage({ chatId, text: "Mark Lab as B", clientOverride: mockClarify });
  assert.equal(reply3, "Which assignment did you mean?");

  closeDb();
  await cleanupDb();
});
