import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "agent_capability_guard_test.db");

function createMockClient(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    responses: {
      create: async (payload) => {
        calls.push(payload);
        if (queue.length === 0) throw new Error("Mock responses exhausted");
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

test("capability guard blocks unsupported monthly recurrence requests", async () => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "200";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "0";
  process.env.OPENAI_CAPABILITY_GUARD = "1";
  process.env.AGENT_DB_PATH = dbPath;

  const { createDb, syncAssignmentsFromState, closeDb } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  syncAssignmentsFromState(db, seedState());
  db.close();

  const mock = createMockClient([
    textResponse(
      "g1",
      JSON.stringify({
        decision: "unsupported",
        reason: "Monthly cadence unsupported",
        message:
          "Monthly recurrence is not supported. I can set a weekly reminder now and adjust it anytime.",
      })
    ),
  ]);

  const reply = await runAgentMessage({
    chatId: `capability-chat-${Date.now()}`,
    text: "Set a monthly reminder at 7am",
    clientOverride: mock,
  });

  assert.match(reply, /monthly recurrence is not supported/i);
  assert.equal(mock.calls.length, 1);
  closeDb();
  await cleanupDb();
});

test("capability guard proceeds for supported assignment queries", async () => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "200";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "0";
  process.env.OPENAI_CAPABILITY_GUARD = "1";
  process.env.AGENT_DB_PATH = dbPath;

  const { createDb, syncAssignmentsFromState, closeDb } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  syncAssignmentsFromState(db, seedState());
  db.close();

  const mock = createMockClient([
    textResponse(
      "g2",
      JSON.stringify({
        decision: "proceed",
        reason: "supported",
        message: "",
      })
    ),
    functionCallResponse(
      "g3",
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
    textResponse("g4", "Missing assignments: Algebra Homework 1."),
  ]);

  const reply = await runAgentMessage({
    chatId: `capability-chat-ok-${Date.now()}`,
    text: "what assignments are missing?",
    clientOverride: mock,
  });

  assert.match(reply, /Missing assignments/i);
  assert.equal(mock.calls.length, 3);
  closeDb();
  await cleanupDb();
});
