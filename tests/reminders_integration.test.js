import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, createTask, listTasks, closeDb } from "../src/db.js";
import { runReminders } from "../src/tasks.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schoology-reminders-"));
}

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    telegram: {
      botToken: "test-token",
      chatIds: ["123"],
    },
    paths: {
      dataDir: tempDir,
      agentDbPath: path.join(tempDir, "agent.db"),
      statePath: path.join(tempDir, "state.json"),
    },
  };
}

test("runReminders sends due tasks and rolls over", async () => {
  const tempDir = makeTempDir();
  const config = makeConfig(tempDir);
  try {
    const db = createDb(config.paths.agentDbPath);
    const created = createTask(db, { title: "Email teacher", remindAt: "2026-02-06T21:00:00Z" });
    db.close();

    let sent = 0;
    await runReminders({
      config,
      nowOverride: "2026-02-06T22:00:00Z",
      senders: {
        telegramRaw: async () => {
          sent += 1;
        },
      },
    });

    const db2 = createDb(config.paths.agentDbPath);
    const tasks = listTasks(db2, { status: "pending" });
    db2.close();

    assert.equal(sent, 1);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].rollCount, 1);
    assert.equal(tasks[0].remindAt, "2026-02-07T21:00:00.000Z");
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
