import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "agent_runtime_test.db");

function createMockClient(responses) {
  const queue = [...responses];
  const calls = [];
  const compactCalls = [];
  return {
    calls,
    compactCalls,
    responses: {
      create: async (payload) => {
        calls.push(payload);
        if (queue.length === 0) {
          throw new Error("Mock responses exhausted");
        }
        return queue.shift();
      },
      compact: async (payload) => {
        compactCalls.push(payload);
        return { id: "compact-1" };
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

test("agent runtime keeps style preferences, replays memory, and compacts", async () => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "200";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "1";
  process.env.OPENAI_COMPACT_AFTER_INPUT_TOKENS = "1";
  process.env.OPENAI_CAPABILITY_GUARD = "0";
  process.env.AGENT_DB_PATH = dbPath;

  const {
    createDb,
    syncAssignmentsFromState,
    closeDb,
    getChatState,
    getChatMemory,
  } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  syncAssignmentsFromState(db, seedState());
  db.close();

  const chatId = `runtime-${Date.now()}`;

  const styleReply = await runAgentMessage({
    chatId,
    text: "use plain language",
  });
  assert.match(styleReply, /plain language/i);

  const styleDb = createDb(dbPath);
  const styleState = getChatState(styleDb, chatId);
  assert.equal(styleState.messageStyle, "plain_language");
  const styleMemory = getChatMemory(styleDb, chatId);
  assert.ok(styleMemory);
  assert.match(styleMemory.summaryText, /Style: plain_language/i);
  styleDb.close();

  const mock = createMockClient([
    functionCallResponse(
      "r1",
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
    textResponse("r2", "Missing assignments: Algebra Homework 1."),
  ]);

  const reply = await runAgentMessage({
    chatId,
    text: "What is missing right now?",
    clientOverride: mock,
  });

  assert.match(reply, /Missing assignments/i);
  assert.equal(mock.compactCalls.length, 1);
  assert.equal(mock.compactCalls[0].previous_response_id, "r2");
  assert.match(mock.calls[0].input, /Current message style: plain_language/i);
  assert.match(mock.calls[0].input, /Stored chat memory/i);

  const dbLive = createDb(dbPath);
  const finalState = getChatState(dbLive, chatId);
  assert.equal(finalState.messageStyle, "plain_language");
  assert.equal(finalState.turnCount, 0);
  assert.ok(finalState.lastCompactAt);

  const finalMemory = getChatMemory(dbLive, chatId);
  assert.ok(finalMemory);
  assert.equal(finalMemory.sourceResponseId, "compact-1");
  assert.match(finalMemory.summaryText, /Last reply:/i);
  dbLive.close();

  closeDb();
  await cleanupDb();
});
