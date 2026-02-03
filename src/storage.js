import fs from "fs";
import path from "path";
import crypto from "crypto";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function loadState(statePath) {
  ensureDir(path.dirname(statePath));
  if (!fs.existsSync(statePath)) {
    return {
      meta: { createdAt: new Date().toISOString() },
      lastScrapeAt: null,
      lastSummarySentAt: null,
      assignments: {},
    };
  }
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return {
      meta: { createdAt: new Date().toISOString(), recoveredAt: new Date().toISOString() },
      lastScrapeAt: null,
      lastSummarySentAt: null,
      assignments: {},
      corruptedState: true,
    };
  }
}

export function saveState(statePath, state) {
  ensureDir(path.dirname(statePath));
  const data = JSON.stringify(state, null, 2);
  fs.writeFileSync(statePath, data, "utf8");
}

export function makeAssignmentKey(assignment) {
  const base = [assignment.url || "", assignment.course || "", assignment.title || "", assignment.dueDate || ""].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

export function updateStateWithScrape(state, scrapeAt, assignments) {
  const seenKeys = new Set();

  for (const item of assignments) {
    const key = makeAssignmentKey(item);
    seenKeys.add(key);
    const existing = state.assignments[key] || {};
    const firstSeenAt = existing.firstSeenAt || scrapeAt;
    state.assignments[key] = {
      key,
      course: item.course || existing.course || "",
      title: item.title || existing.title || "",
      dueDate: item.dueDate || existing.dueDate || "",
      status: item.status || existing.status || "Missing",
      score: item.score || existing.score || "",
      url: item.url || existing.url || "",
      rawText: item.rawText || existing.rawText || "",
      firstSeenAt,
      lastSeenAt: scrapeAt,
      isMissing: true,
      lastMissingAt: scrapeAt,
      resolvedAt: existing.resolvedAt || null,
    };
  }

  for (const [key, item] of Object.entries(state.assignments)) {
    if (item.isMissing && !seenKeys.has(key)) {
      state.assignments[key] = {
        ...item,
        isMissing: false,
        resolvedAt: scrapeAt,
      };
    }
  }

  state.lastScrapeAt = scrapeAt;
  return state;
}

function parseDate(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function compareAssignments(a, b) {
  const courseA = (a.course || "").toLowerCase();
  const courseB = (b.course || "").toLowerCase();
  if (courseA !== courseB) return courseA.localeCompare(courseB);

  const dateA = parseDate(a.dueDate || "");
  const dateB = parseDate(b.dueDate || "");
  if (dateA !== null && dateB !== null && dateA !== dateB) return dateA - dateB;

  const titleA = (a.title || "").toLowerCase();
  const titleB = (b.title || "").toLowerCase();
  return titleA.localeCompare(titleB);
}

export function buildSummary(state, lastSummarySentAt) {
  const assignments = Object.values(state.assignments || {});
  const lastSummaryMs = lastSummarySentAt ? Date.parse(lastSummarySentAt) : 0;

  const currentMissing = assignments.filter((a) => a.isMissing);
  const newMissing = currentMissing.filter((a) => Date.parse(a.firstSeenAt || "") > lastSummaryMs);
  const resolvedSince = assignments.filter((a) => a.resolvedAt && Date.parse(a.resolvedAt) > lastSummaryMs);

  currentMissing.sort(compareAssignments);
  newMissing.sort(compareAssignments);
  resolvedSince.sort(compareAssignments);

  return {
    currentMissing,
    newMissing,
    resolvedSince,
  };
}
