import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, syncAssignmentsFromState, closeDb } from "../src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = path.join(__dirname, "..", "docs", "TEST_RESULTS.md");
const dbPath = path.join(__dirname, "..", "data", "agent_test.db");

function append(line) {
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

function seedDb(db) {
  const state = {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "Homework 1",
        dueDate: "2026-01-01",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
        lastMissingAt: "2026-01-02T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a2: {
        key: "a2",
        course: "Science",
        title: "Lab 1",
        dueDate: "2026-01-02",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
        lastMissingAt: "2026-01-02T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  };
  syncAssignmentsFromState(db, state);
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
  append(`\nAgentic conversation cleanup warning: failed to delete ${dbPath}`);
}

async function main() {
  process.env.AGENT_DB_PATH = dbPath;

  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  seedDb(db);
  db.close();

  append("\n## Agentic Conversation Test");

  const chatId = `test-${Date.now()}`;

  const q1 = "What assignments are missing?";
  const r1 = await runAgentMessage({ chatId, text: q1 });
  append(`\n**User:** ${q1}`);
  append(`\n**Agent:** ${r1}`);

  const q2 = "Mark Homework 1 as B";
  const r2 = await runAgentMessage({ chatId, text: q2 });
  append(`\n**User:** ${q2}`);
  append(`\n**Agent:** ${r2}`);

  const q3 = "What is missing now?";
  const r3 = await runAgentMessage({ chatId, text: q3 });
  append(`\n**User:** ${q3}`);
  append(`\n**Agent:** ${r3}`);

  append("\nAgentic conversation test completed.");

  closeDb();
  await cleanupDb();
}

main().catch((err) => {
  append(`\nAgentic conversation test failed: ${err?.message || err}`);
  process.exit(1);
});
