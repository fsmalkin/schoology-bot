import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { closeDb, getDb } from "../src/db.js";
import { renderDashboardPage } from "../src/dashboard_server.js";
import { runToolByName } from "../src/tool_runner.js";
import {
  dashboardWrite,
  makeDashboardConfig,
  makeDashboardTempDir,
  seedDashboardAssignments,
  seedDashboardStateFile,
  startDashboardServer,
} from "./dashboard_test_utils.js";

test("renderDashboardPage includes parent-first shell and asset refs", () => {
  const html = renderDashboardPage();
  assert.match(html, /Schoology Bot/i);
  assert.match(html, /All Schoolwork/i);
  assert.match(html, /System Health/i);
  assert.match(html, /drawerBackdrop/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /\/assets\/dashboard\.css/);
  assert.match(html, /\/assets\/dashboard\.js/);
});

test("dashboard server serves page, assets, and parent-first read APIs", async () => {
  const tempDir = makeDashboardTempDir("schoology-dashboard-server-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);

  const { port, stop } = await startDashboardServer({
    config,
    logger: { log: () => {} },
  });
  try {
    assert.ok(port > 0);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Schoology Bot/i);
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

    const betaPage = await fetch(`http://127.0.0.1:${port}/beta`);
    assert.equal(betaPage.status, 200);
    const betaHtml = await betaPage.text();
    assert.match(betaHtml, /Schoology Bot/i);
    assert.match(betaHtml, /Beta/);
    assert.match(betaHtml, /\/assets\/dashboard\.css/);
    assert.match(betaHtml, /\/beta\/assets\/beta\.css/);
    assert.match(betaHtml, /\/beta\/assets\/beta\.js/);

    const betaCss = await fetch(`http://127.0.0.1:${port}/beta/assets/beta.css`);
    assert.equal(betaCss.status, 200);
    const betaCssText = await betaCss.text();
    assert.match(betaCssText, /beta-section/);
    assert.match(betaCssText, /beta-badge/);

    const betaJs = await fetch(`http://127.0.0.1:${port}/beta/assets/beta.js`);
    assert.equal(betaJs.status, 200);
    const betaJsText = await betaJs.text();
    assert.match(betaJsText, /beta-toggle-section/);
    assert.match(betaJsText, /openAssignmentDrawer/);
  } finally {
    await stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard write API rejects unsafe requests", async () => {
  const tempDir = makeDashboardTempDir("schoology-dashboard-unsafe-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);

  const { port, stop } = await startDashboardServer({
    config,
    logger: { log: () => {} },
  });
  try {
    const missingHeaders = await fetch(`http://127.0.0.1:${port}/api/tools/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "update_assignment_status", args: { key: "a1", status: "Waiting on teacher" } }),
    });
    assert.equal(missingHeaders.status, 403);

    const unsupportedTool = await dashboardWrite(port, "list_tasks", {});
    assert.equal(unsupportedTool.status, 400);
  } finally {
    await stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard write API supports assignment and follow-up mutations", async () => {
  const tempDir = makeDashboardTempDir("schoology-dashboard-mutations-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  let refreshCalled = false;

  const toolExecutor = async (toolDb, tool, args, context) => {
    if (tool === "refresh_schoology") {
      refreshCalled = true;
      return { ok: true, refreshed: true };
    }
    return runToolByName(toolDb, tool, args, context);
  };

  const { port, stop } = await startDashboardServer({
    config,
    logger: { log: () => {} },
    toolExecutor,
  });
  try {
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
    await stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
