import fs from "fs";
import path from "path";
import crypto from "crypto";
import { deriveSchoologyAssignmentTitle } from "./text_utils.js";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseDateMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
}

function maxDateValue(...values) {
  let best = null;
  let bestMs = null;
  for (const value of values) {
    if (!value) continue;
    const ms = parseDateMs(value);
    if (ms === null) continue;
    if (bestMs === null || ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

function minDateValue(...values) {
  let best = null;
  let bestMs = null;
  for (const value of values) {
    if (!value) continue;
    const ms = parseDateMs(value);
    if (ms === null) continue;
    if (bestMs === null || ms < bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

function normalizeAssignmentShape(key, item = {}) {
  const assignmentId = extractAssignmentId(item.url || "") || item.assignmentId || "";
  const normalizedKey = assignmentId ? `assignment:${assignmentId}` : key;
  const rawText = item.rawText || "";
  return {
    key: normalizedKey,
    assignmentId,
    course: item.course || "",
    title: deriveSchoologyAssignmentTitle({ title: item.title || "", rawText }),
    dueDate: item.dueDate || "",
    status: item.status || "",
    score: item.score || "",
    url: item.url || "",
    rawText,
    firstSeenAt: item.firstSeenAt || "",
    lastSeenAt: item.lastSeenAt || "",
    isMissing: item.isMissing === true,
    lastMissingAt: item.lastMissingAt || null,
    resolvedAt: item.resolvedAt || null,
  };
}

function mergeAssignmentRecords(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;

  const currentMs = parseDateMs(current.lastSeenAt || current.firstSeenAt || "");
  const incomingMs = parseDateMs(incoming.lastSeenAt || incoming.firstSeenAt || "");
  const incomingIsNewer =
    incomingMs !== null && (currentMs === null || incomingMs >= currentMs);
  const preferred = incomingIsNewer ? incoming : current;
  const secondary = incomingIsNewer ? current : incoming;

  return {
    ...secondary,
    ...preferred,
    key: preferred.key || secondary.key,
    assignmentId: preferred.assignmentId || secondary.assignmentId || "",
    course: preferred.course || secondary.course || "",
    title: preferred.title || secondary.title || "",
    dueDate: preferred.dueDate || secondary.dueDate || "",
    status: preferred.status || secondary.status || "",
    score: preferred.score || secondary.score || "",
    url: preferred.url || secondary.url || "",
    rawText: preferred.rawText || secondary.rawText || "",
    firstSeenAt: minDateValue(current.firstSeenAt, incoming.firstSeenAt) || preferred.firstSeenAt || "",
    lastSeenAt: maxDateValue(current.lastSeenAt, incoming.lastSeenAt) || preferred.lastSeenAt || "",
    lastMissingAt: maxDateValue(current.lastMissingAt, incoming.lastMissingAt),
    resolvedAt: maxDateValue(current.resolvedAt, incoming.resolvedAt),
    isMissing: preferred.isMissing === true,
  };
}

function normalizeStateAssignments(assignments = {}) {
  const normalized = {};
  for (const [legacyKey, raw] of Object.entries(assignments || {})) {
    const source = normalizeAssignmentShape(legacyKey, raw || {});
    const key = source.key || legacyKey;
    const existing = normalized[key] || null;
    normalized[key] = mergeAssignmentRecords(existing, source);
  }
  return normalized;
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
    const parsed = JSON.parse(raw);
    parsed.assignments = normalizeStateAssignments(parsed.assignments || {});
    return parsed;
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
  state.assignments = normalizeStateAssignments(state.assignments || {});
  const data = JSON.stringify(state, null, 2);
  fs.writeFileSync(statePath, data, "utf8");
}

export function extractAssignmentId(assignmentOrUrl) {
  const raw =
    typeof assignmentOrUrl === "string"
      ? assignmentOrUrl
      : assignmentOrUrl?.url || "";
  const text = String(raw || "").trim();
  if (!text) return "";

  const fromPath = (candidate) => {
    const match = String(candidate || "").match(/\/assignment\/(\d+)(?:[/?#]|$)/i);
    return match ? String(match[1]) : "";
  };

  try {
    const parsed = new URL(text);
    const id = fromPath(parsed.pathname);
    if (id) return id;
  } catch {
    // Ignore parse errors and fall back to regex over raw string.
  }

  return fromPath(text);
}

export function makeAssignmentKey(assignment) {
  const assignmentId = extractAssignmentId(assignment);
  if (assignmentId) {
    return `assignment:${assignmentId}`;
  }
  const base = [assignment.url || "", assignment.course || "", assignment.title || "", assignment.dueDate || ""].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

export function updateStateWithScrape(state, scrapeAt, assignments) {
  state.assignments = normalizeStateAssignments(state.assignments || {});
  const seenKeys = new Set();

  for (const item of assignments) {
    const assignmentId = extractAssignmentId(item);
    const key = makeAssignmentKey(item);
    seenKeys.add(key);
    const existing = normalizeAssignmentShape(key, state.assignments[key] || {});
    const firstSeenAt = existing.firstSeenAt || scrapeAt;
    const isMissing = item.isMissing === true;
    const wasMissing = existing.isMissing === true;
    const resolvedAt = !isMissing && wasMissing ? scrapeAt : existing.resolvedAt || null;
    const rawText = item.rawText || existing.rawText || "";
    const updated = {
      key,
      assignmentId,
      course: item.course || existing.course || "",
      title: deriveSchoologyAssignmentTitle({
        title: item.title || existing.title || "",
        rawText,
      }),
      dueDate: item.dueDate || existing.dueDate || "",
      status: item.status || existing.status || "",
      score: item.score || existing.score || "",
      url: item.url || existing.url || "",
      rawText,
      firstSeenAt,
      lastSeenAt: scrapeAt,
      isMissing,
      lastMissingAt: isMissing ? scrapeAt : existing.lastMissingAt || null,
      resolvedAt,
    };
    state.assignments[key] = mergeAssignmentRecords(existing, updated);
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
