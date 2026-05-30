import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, recordManagedAgentEvent, upsertManagedAgentSession } from "../src/db.js";
import { buildDashboardSnapshot } from "../src/dashboard_data.js";
import { writeServiceHeartbeat } from "../src/health.js";

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    liveChecks: { enabled: false, cron: "0 5 * * *" },
    paths: {
      dataDir: tempDir,
      statePath: path.join(tempDir, "state.json"),
      agentDbPath: path.join(tempDir, "agent.db"),
    },
  };
}

function seedAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/20/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, 'Waiting on teacher', 0),
      ('a3', 'Science: Sec 1', 'Lab 1', '2/22/26 11:59pm', 'Missing', '', '', 'assignment submitted', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0)
  `
  ).run();
}

function seedTasks(db) {
  db.prepare(
    `
    INSERT INTO tasks (assignment_key, title, message, remind_at, status, kind, auto_cancel_on_resolve, auto_planned, created_at)
    VALUES
      (NULL, 'Ask teacher', 'follow up', '2026-02-15T10:00:00Z', 'pending', 'personal', 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Read chapter', 'today', '2026-02-16T16:00:00Z', 'pending', 'personal', 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Practice', 'tomorrow', '2026-02-17T16:00:00Z', 'pending', 'personal', 0, 0, '2026-02-10T00:00:00Z')
  `
  ).run();
}

test("buildDashboardSnapshot reports core health and counts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-data-"));
  try {
    const config = makeConfig(tempDir);
    const db = createDb(":memory:");
    seedAssignments(db);
    seedTasks(db);

    const snapshot = buildDashboardSnapshot({
      config,
      now: new Date("2026-02-16T17:00:00Z"),
      dbOverride: db,
      stateOverride: {
        lastScrapeAt: "2026-02-16T11:00:00Z",
        lastSummarySentAt: "2026-02-16T12:00:00Z",
      },
      heartbeatsOverride: {
        scheduler: {
          timestamp: "2026-02-16T16:59:40Z",
          status: "running",
        },
        "telegram-agent": {
          timestamp: "2026-02-16T16:59:45Z",
          status: "running",
        },
      },
    });

    assert.equal(snapshot.assignments.actionable, 1);
    assert.equal(snapshot.assignments.waiting, 1);
    assert.equal(snapshot.assignments.ignored, 1);
    assert.equal(snapshot.tasks.pending, 3);
    assert.equal(snapshot.tasks.overdue, 1);
    assert.equal(snapshot.tasks.today, 1);
    assert.equal(snapshot.tasks.upcoming, 1);
    assert.equal(snapshot.services[0].state, "ok");
    assert.equal(snapshot.services[1].state, "ok");
    assert.equal(snapshot.activity.scrapeStale, false);
    assert.equal(snapshot.activity.summaryStale, false);
    assert.equal(Array.isArray(snapshot.quickCommands), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildDashboardSnapshot includes managed agents health when runtime is enabled", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-managed-"));
  try {
    const config = makeConfig(tempDir);
    config.runtime = { stack: "managed-agents" };
    config.managedAgents = {
      enabled: true,
      environment: "dev",
      sessionNamespace: "schoology-dev",
      sessionTtlMinutes: 60,
      idleTimeoutMinutes: 10,
    };
    const db = createDb(":memory:");
    upsertManagedAgentSession(db, {
      chatId: "chat-1",
      environment: "schoology-dev",
      sessionId: "sesn_dashboard",
      createdAt: "2026-02-16T16:30:00Z",
      updatedAt: "2026-02-16T16:58:00Z",
      lastEventAt: "2026-02-16T16:58:00Z",
      expiresAt: "2026-02-16T17:30:00Z",
      metadata: { lastEventType: "telegram_message" },
    });
    recordManagedAgentEvent(db, {
      chatId: "chat-1",
      environment: "schoology-dev",
      sessionId: "sesn_dashboard",
      eventType: "turn_completed",
      status: "ok",
      summary: "Managed turn completed.",
      createdAt: "2026-02-16T16:58:00Z",
    });

    const snapshot = buildDashboardSnapshot({
      config,
      now: new Date("2026-02-16T17:00:00Z"),
      dbOverride: db,
      stateOverride: {},
      heartbeatsOverride: {
        scheduler: { timestamp: "2026-02-16T16:59:40Z", status: "running" },
        "telegram-agent": { timestamp: "2026-02-16T16:59:45Z", status: "running" },
        "managed-agent-bridge": { timestamp: "2026-02-16T16:59:50Z", status: "running" },
      },
    });

    assert.equal(snapshot.managedAgents.enabled, true);
    assert.equal(snapshot.managedAgents.environment, "schoology-dev");
    assert.equal(snapshot.managedAgents.activeSessionCount, 1);
    assert.equal(snapshot.managedAgents.recentEvents[0].eventType, "turn_completed");
    assert.ok(snapshot.services.some((service) => service.key === "managed-agent-bridge"));
    assert.ok(snapshot.quickCommands[0].includes("docker-compose.managed-prod.yml"));
    assert.ok(snapshot.quickCommands.at(-1).includes("-f docker-compose.yml -p schoology-prod up"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildDashboardSnapshot can surface managed-dev runtime from beta data", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-managed-beta-"));
  try {
    const config = makeConfig(tempDir);
    const betaDir = path.join(tempDir, "beta");
    fs.mkdirSync(betaDir, { recursive: true });
    const betaConfig = {
      ...config,
      runtime: { stack: "managed-agents" },
      managedAgents: {
        enabled: true,
        environment: "dev",
        sessionNamespace: "schoology-dev",
        sessionTtlMinutes: 60,
        idleTimeoutMinutes: 10,
      },
      paths: {
        ...config.paths,
        dataDir: betaDir,
        statePath: path.join(betaDir, "state.json"),
        agentDbPath: path.join(betaDir, "agent.runtime.db"),
      },
    };
    const betaDb = createDb(betaConfig.paths.agentDbPath);
    upsertManagedAgentSession(betaDb, {
      chatId: "chat-beta",
      environment: "schoology-dev",
      sessionId: "sesn_beta",
      createdAt: "2026-02-16T16:30:00Z",
      updatedAt: "2026-02-16T16:58:00Z",
      lastEventAt: "2026-02-16T16:58:00Z",
      expiresAt: "2026-02-16T17:30:00Z",
      metadata: { lastEventType: "telegram_message" },
    });
    recordManagedAgentEvent(betaDb, {
      chatId: "chat-beta",
      environment: "schoology-dev",
      sessionId: "sesn_beta",
      eventType: "turn_completed",
      status: "ok",
      summary: "Managed-dev turn completed.",
      createdAt: "2026-02-16T16:58:00Z",
    });
    betaDb.close();
    writeServiceHeartbeat(betaConfig, "managed-agent-bridge", {
      status: "running",
      environment: "schoology-dev",
    });

    const db = createDb(":memory:");
    const snapshot = buildDashboardSnapshot({
      config,
      now: new Date("2026-02-16T17:00:00Z"),
      dbOverride: db,
      stateOverride: {},
      heartbeatsOverride: {
        scheduler: { timestamp: "2026-02-16T16:59:40Z", status: "running" },
        "telegram-agent": { timestamp: "2026-02-16T16:59:45Z", status: "running" },
      },
    });

    assert.equal(snapshot.managedAgents.enabled, true);
    assert.equal(snapshot.managedAgents.runtimeLabel, "managed-dev");
    assert.equal(snapshot.managedAgents.recentEvents[0].summary, "Managed-dev turn completed.");
    assert.equal(snapshot.services.find((service) => service.key === "managed-agent-bridge")?.state, "ok");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
