import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../src/db.js";
import { createDashboardServer, renderDashboardPage } from "../src/dashboard_server.js";
import { runToolByName } from "../src/tool_runner.js";

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    liveChecks: {
      enabled: false,
      cron: "0 5 * * *",
    },
    paths: {
      dataDir: tempDir,
      statePath: path.join(tempDir, "state.json"),
      agentDbPath: path.join(tempDir, "agent.db"),
    },
  };
}

function seedStateFile(config) {
  fs.writeFileSync(
    config.paths.statePath,
    JSON.stringify(
      {
        meta: { createdAt: new Date().toISOString() },
        lastScrapeAt: "2026-02-16T11:00:00Z",
        lastSummarySentAt: "2026-02-16T12:00:00Z",
        assignments: {},
      },
      null,
      2
    ),
    "utf8"
  );
}

function seedAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/15/26 11:59pm', 'Missing', '', 'https://schoology.local/a1', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0)
  `
  ).run();
}

function sameOriginHeaders(port) {
  return {
    origin: `http://127.0.0.1:${port}`,
    "X-Schoology-Dashboard-Request": "1",
    "Content-Type": "application/json",
  };
}

async function dashboardWrite(port, tool, args, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/api/tools/run`, {
    method: "POST",
    headers: {
      ...sameOriginHeaders(port),
      ...headers,
    },
    body: JSON.stringify({ tool, args }),
  });
}

test("renderDashboardPage includes parent-first shell and asset refs", () => {
  const html = renderDashboardPage();
  assert.match(html, /School nights, without the scramble/i);
  assert.match(html, /All Schoolwork/i);
  assert.match(html, /Admin/i);
  assert.match(html, /drawerBackdrop/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /\/assets\/dashboard\.css/);
  assert.match(html, /\/assets\/dashboard\.js/);
});

test("dashboard server serves page, assets, and parent-first read APIs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-server-"));
  const config = makeConfig(tempDir);
  seedStateFile(config);
  const db = getDb(config);
  seedAssignments(db);

  const server = createDashboardServer({ config, logger: { log: () => {} } });
  try {
    await server.start(0);
    const address = server.server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    assert.ok(port > 0);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /School nights, without the scramble/i);
    assert.match(html, /drawerBackdrop/);

    const asset = await fetch(`http://127.0.0.1:${port}/assets/dashboard.js`);
    assert.equal(asset.status, 200);
    const assetText = await asset.text();
    assert.match(assetText, /data-open-assignment-key/);
    assert.match(assetText, /toggle-bulk-mode/);

    const meta = await fetch(`http://127.0.0.1:${port}/api/meta`);
    assert.equal(meta.status, 200);
    const metaPayload = await meta.json();
    assert.equal(metaPayload.primaryViews[0].id, "home");
    assert.equal(metaPayload.utilityViews[0].id, "admin");

    const home = await fetch(`http://127.0.0.1:${port}/api/home`);
    const homePayload = await home.json();
    assert.equal(home.status, 200);
    assert.ok(Array.isArray(homePayload.sections.tonight.rows));

    const assignments = await fetch(`http://127.0.0.1:${port}/api/assignments?status=missing&includePending=true&includeIgnored=true`);
    const assignmentPayload = await assignments.json();
    assert.equal(assignments.status, 200);
    assert.equal(assignmentPayload.rows.length, 2);

    const detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    const detailPayload = await detail.json();
    assert.equal(detail.status, 200);
    assert.equal(detailPayload.assignment.key, "a1");

    const tasks = await fetch(`http://127.0.0.1:${port}/api/tasks?status=all`);
    assert.equal(tasks.status, 200);
    assert.ok(Array.isArray((await tasks.json()).rows));

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const healthPayload = await health.json();
    assert.equal(health.status, 200);
    assert.ok(Array.isArray(healthPayload.services));
  } finally {
    await server.stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard write API rejects unsafe requests", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-unsafe-"));
  const config = makeConfig(tempDir);
  seedStateFile(config);
  const db = getDb(config);
  seedAssignments(db);

  const server = createDashboardServer({ config, logger: { log: () => {} } });
  try {
    await server.start(0);
    const address = server.server.address();
    const port = address && typeof address === "object" ? address.port : 0;

    const missingHeaders = await fetch(`http://127.0.0.1:${port}/api/tools/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "update_assignment_status", args: { key: "a1", status: "Waiting on teacher" } }),
    });
    assert.equal(missingHeaders.status, 403);

    const unsupportedTool = await dashboardWrite(port, "list_tasks", {});
    assert.equal(unsupportedTool.status, 400);
  } finally {
    await server.stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard write API supports assignment and follow-up mutations", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-mutations-"));
  const config = makeConfig(tempDir);
  seedStateFile(config);
  const db = getDb(config);
  seedAssignments(db);
  let refreshCalled = false;

  const toolExecutor = async (toolDb, tool, args, context) => {
    if (tool === "refresh_schoology") {
      refreshCalled = true;
      return { ok: true, refreshed: true };
    }
    return runToolByName(toolDb, tool, args, context);
  };

  const server = createDashboardServer({ config, logger: { log: () => {} }, toolExecutor });
  try {
    await server.start(0);
    const address = server.server.address();
    const port = address && typeof address === "object" ? address.port : 0;

    let response = await dashboardWrite(port, "update_assignment_status", {
      key: "a1",
      status: "Waiting on teacher",
    });
    let payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "update_assignment_status", {
      key: "a1",
      status: "",
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "bulk_update_assignment_statuses", {
      updates: [
        { key: "a1", status: "Waiting on teacher" },
        { key: "a2", status: "Waiting on teacher" },
      ],
    });
    payload = await response.json();
    assert.equal(payload.output.successCount, 2);

    response = await dashboardWrite(port, "add_assignment_note", {
      key: "a1",
      note: "Remember to attach work shown",
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "schedule_reminder", {
      key: "a1",
      remindAt: "2026-02-17T16:30",
      recurrence: "weekly",
      message: "Check Schoology update",
      replaceExisting: true,
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);
    const reminderId = payload.output.reminder.id;

    response = await dashboardWrite(port, "update_assignment_reminder", {
      id: reminderId,
      remindAt: "2026-02-18T16:30",
      recurrence: "daily",
      message: "Updated reminder",
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "delete_assignment_reminder", { id: reminderId });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "create_task", {
      title: "Check planner",
      remindAt: "2026-02-18T19:00",
      recurrence: "weekdays",
      message: "Review homework list",
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);
    const taskId = payload.output.id;

    response = await dashboardWrite(port, "update_task", {
      id: taskId,
      title: "Check planner and email teacher",
      remindAt: "2026-02-19T19:00",
      recurrence: "daily",
      message: "Updated task note",
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "update_task_status", {
      id: taskId,
      status: "done",
    });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "delete_task", { id: taskId });
    payload = await response.json();
    assert.equal(payload.output.ok, true);

    response = await dashboardWrite(port, "refresh_schoology", {});
    payload = await response.json();
    assert.equal(payload.output.refreshed, true);
    assert.equal(refreshCalled, true);

    const detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.notes.length, 1);
    assert.equal(detailPayload.pendingReminder, null);

    const tasks = await fetch(`http://127.0.0.1:${port}/api/tasks?status=all`);
    const tasksPayload = await tasks.json();
    assert.equal(tasksPayload.rows.length, 0);
  } finally {
    await server.stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
