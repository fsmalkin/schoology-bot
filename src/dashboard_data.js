import fs from "fs";
import path from "path";
import { ensureDbSeeded, getDb, listAssignments, listTasks } from "./db.js";
import { readServiceHeartbeat, summarizeHeartbeat, formatDurationMinutes } from "./health.js";
import { buildDbSummary } from "./summary.js";
import { loadState } from "./storage.js";
import { formatDateYmd } from "./time.js";

const SCRAPE_STALE_HOURS = 36;
const SUMMARY_STALE_HOURS = 36;

function toDate(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function ageMsFrom(nowDate, value) {
  const parsed = toDate(value);
  if (!parsed) return null;
  return Math.max(0, nowDate.getTime() - parsed.getTime());
}

function formatDateTimeLabel(value, timeZone) {
  const parsed = toDate(value);
  if (!parsed) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(parsed);
}

function formatRelativeAge(ageMs) {
  if (!Number.isFinite(ageMs)) return "n/a";
  return formatDurationMinutes(ageMs);
}

function serviceSnapshot(config, serviceName, nowDate, staleMs, heartbeatOverride = null) {
  const heartbeat = heartbeatOverride || readServiceHeartbeat(config, serviceName);
  const summary = summarizeHeartbeat(heartbeat, nowDate, staleMs);
  const labels = {
    scheduler: "Scheduler",
    "telegram-agent": "Telegram Agent",
    "schoology-tool-api": "Schoology Tool API",
    "openclaw-gateway": "OpenClaw Gateway",
  };
  const label = labels[serviceName] || serviceName;
  return {
    key: serviceName,
    label,
    state: summary.state,
    ok: summary.ok,
    ageMs: summary.ageMs,
    ageLabel: formatRelativeAge(summary.ageMs),
    lastSeenLabel: formatDateTimeLabel(summary.timestamp, config.schedule.timezone),
    details: heartbeat || {},
  };
}

function getRuntimeStack(config) {
  return String(config?.runtime?.stack || "legacy").toLowerCase();
}

function getServiceNames(config) {
  if (getRuntimeStack(config) === "openclaw") {
    return ["schoology-tool-api", "openclaw-gateway"];
  }
  return ["scheduler", "telegram-agent"];
}

function buildTaskStats(tasks, timeZone, nowDate) {
  const today = formatDateYmd(nowDate, timeZone);
  let dueNow = 0;
  let overdue = 0;
  let todayCount = 0;
  let upcoming = 0;

  for (const task of tasks) {
    const remindAt = toDate(task.remindAt);
    if (!remindAt) continue;
    if (remindAt <= nowDate) {
      dueNow += 1;
    }
    const dateLabel = formatDateYmd(remindAt, timeZone);
    if (dateLabel < today) {
      overdue += 1;
    } else if (dateLabel === today) {
      todayCount += 1;
    } else {
      upcoming += 1;
    }
  }

  return {
    pending: tasks.length,
    dueNow,
    overdue,
    today: todayCount,
    upcoming,
  };
}

function buildAssignmentStats(db) {
  const summary = buildDbSummary(db, {
    includePending: true,
    includeIgnored: false,
    includeNotes: false,
    limit: 1000,
  });
  const missingWithIgnored = listAssignments(db, {
    status: "missing",
    includeIgnored: true,
    includePending: true,
    limit: 1000,
  });
  const ignored = missingWithIgnored.filter((row) => row.statusCategory === "ignored").length;
  const totalMissing = missingWithIgnored.length;

  return {
    actionable: summary.actionable.length,
    waiting: summary.pending.length,
    ignored,
    totalMissing,
  };
}

function fileState(config) {
  const checks = [
    { key: "state", label: "state.json", path: config.paths.statePath },
    { key: "agentLog", label: "agent.log", path: path.join(config.paths.dataDir, "agent.log") },
    { key: "agentDb", label: "agent.db", path: config.paths.agentDbPath },
  ];

  return checks.map((item) => {
    const exists = fs.existsSync(item.path);
    return {
      key: item.key,
      label: item.label,
      path: item.path,
      exists,
    };
  });
}

export function buildDashboardSnapshot({
  config,
  now = new Date(),
  dbOverride = null,
  stateOverride = null,
  heartbeatsOverride = null,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const db = dbOverride || getDb(config);
  if (!dbOverride) {
    ensureDbSeeded(db, config.paths.statePath);
  }
  const state = stateOverride || loadState(config.paths.statePath);

  const scrapeAgeMs = ageMsFrom(nowDate, state.lastScrapeAt);
  const summaryAgeMs = ageMsFrom(nowDate, state.lastSummarySentAt);
  const staleScrapeMs = SCRAPE_STALE_HOURS * 60 * 60 * 1000;
  const staleSummaryMs = SUMMARY_STALE_HOURS * 60 * 60 * 1000;

  const pendingTasks = listTasks(db, { status: "pending" });
  const tasks = buildTaskStats(pendingTasks, config.schedule.timezone, nowDate);
  const assignments = buildAssignmentStats(db);

  return {
    generatedAt: nowDate.toISOString(),
    timezone: config.schedule.timezone,
    services: getServiceNames(config).map((serviceName) =>
      serviceSnapshot(
        config,
        serviceName,
        nowDate,
        120000,
        heartbeatsOverride?.[serviceName] || null
      )
    ),
    schedule: {
      scrapeCron: config.schedule.scrapeCron,
      sendCron: config.schedule.sendCron,
      reminderCron: config.schedule.reminderCron,
      liveCheckCron: config.liveChecks.enabled ? config.liveChecks.cron : null,
      liveChecksEnabled: config.liveChecks.enabled === true,
    },
    activity: {
      lastScrapeAt: state.lastScrapeAt || null,
      lastScrapeLabel: formatDateTimeLabel(state.lastScrapeAt, config.schedule.timezone),
      lastScrapeAgeLabel: formatRelativeAge(scrapeAgeMs),
      scrapeStale: Number.isFinite(scrapeAgeMs) ? scrapeAgeMs > staleScrapeMs : true,
      lastSummaryAt: state.lastSummarySentAt || null,
      lastSummaryLabel: formatDateTimeLabel(state.lastSummarySentAt, config.schedule.timezone),
      lastSummaryAgeLabel: formatRelativeAge(summaryAgeMs),
      summaryStale: Number.isFinite(summaryAgeMs) ? summaryAgeMs > staleSummaryMs : true,
    },
    assignments,
    tasks,
    files: fileState(config),
    docs: {
      system: "docs/SYSTEM.md",
      roadmap: "docs/ROADMAP.md",
      coverage: "docs/TEST_COVERAGE.md",
      dashboard: "docs/DASHBOARD.md",
    },
    quickCommands:
      getRuntimeStack(config) === "openclaw"
        ? [
            "docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta up -d --build",
            "docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-gateway",
            "docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 schoology-tool-api",
            "docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta down",
          ]
        : [
            "docker compose up -d --build",
            "docker compose logs --tail 200 telegram-agent",
            "docker compose logs --tail 200 schoology",
            "docker compose down",
          ],
    howItWorks:
      getRuntimeStack(config) === "openclaw"
        ? [
            "OpenClaw gateway handles Telegram chat and cron-triggered automation.",
            "Schoology Tool API executes deterministic Schoology/task actions against local DB/state.",
            "Gateway cron runs scrape refresh, daily summary, and due reminder jobs.",
            "Dashboard reads local state/DB/heartbeat files to show health.",
          ]
        : [
            "Scheduler scrapes Schoology and updates local state + DB.",
            "Agent chat updates local statuses, notes, reminders, and tasks.",
            "Summary sends once daily; reminders run on reminder cron.",
            "Dashboard reads local state/DB/heartbeat files to show health.",
          ],
  };
}
