import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDashboardServer } from "../src/dashboard_server.js";

export function makeDashboardConfig(tempDir) {
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

export function makeDashboardTempDir(prefix = "schoology-dashboard-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function seedDashboardStateFile(config, state = {}) {
  fs.writeFileSync(
    config.paths.statePath,
    JSON.stringify(
      {
        meta: { createdAt: new Date().toISOString() },
        lastScrapeAt: "2026-02-16T11:00:00Z",
        lastSummarySentAt: "2026-02-16T12:00:00Z",
        assignments: {},
        ...state,
      },
      null,
      2
    ),
    "utf8"
  );
}

export function seedDashboardAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/15/26 11:59pm', 'Missing', '', 'https://schoology.local/a1', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, 'Waiting on teacher', 0)
  `
  ).run();
}

export function seedDashboardTasks(db) {
  db.prepare(
    `
    INSERT INTO tasks (
      assignment_key, title, message, remind_at, status, kind, recurrence_kind, recurrence_tz, auto_cancel_on_resolve, auto_planned, created_at
    )
    VALUES
      (NULL, 'Ask teacher', 'follow up tomorrow', '2026-02-16T22:00:00Z', 'pending', 'personal', 'none', NULL, 0, 0, '2026-02-10T00:00:00Z')
  `
  ).run();
}

export function sameOriginHeaders(port) {
  return {
    origin: `http://127.0.0.1:${port}`,
    "X-Schoology-Dashboard-Request": "1",
    "Content-Type": "application/json",
  };
}

export async function dashboardWrite(port, tool, args, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/api/tools/run`, {
    method: "POST",
    headers: {
      ...sameOriginHeaders(port),
      ...headers,
    },
    body: JSON.stringify({ tool, args }),
  });
}

export async function startDashboardServer(options) {
  const server = createDashboardServer(options);
  await server.start(0);
  const address = server.server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  if (!port) {
    throw new Error("Dashboard server failed to bind an ephemeral port.");
  }
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      await server.stop();
    },
  };
}
