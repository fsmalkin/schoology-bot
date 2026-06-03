import {
  getConversationContext,
  listConversationContexts,
  setConversationContext,
} from "./db.js";

export const CONTEXT_TYPES = {
  ASSIGNMENT_LIST: "last_displayed_assignment_list",
  CREATED_ISSUE: "last_created_issue",
};

const MAX_CONTEXT_ASSIGNMENTS = 50;
const MAX_PROMPT_ASSIGNMENTS = 25;
const DEFAULT_CONTEXT_TTL_HOURS = 24;

function compactText(value, maxLength = 240) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assignmentFromRow(row, index) {
  return {
    index,
    key: String(row?.key || "").trim(),
    assignmentId: row?.assignmentId || row?.assignment_id || null,
    title: compactText(row?.title || "", 180),
    course: compactText(row?.course || "", 140),
    dueDate: compactText(row?.dueDate || row?.due_date || "", 80),
    dueCategory: row?.dueCategory || null,
    status: compactText(row?.effectiveStatus || row?.status || row?.manualStatus || "", 120),
    manualStatus: compactText(row?.manualStatus || "", 120),
    statusCategory: row?.statusCategory || null,
    url: compactText(row?.url || "", 240),
  };
}

function flattenAssignmentOutput(assignments) {
  if (Array.isArray(assignments)) return assignments;
  if (assignments?.buckets && typeof assignments.buckets === "object") {
    return [
      ...(Array.isArray(assignments.buckets.actionable) ? assignments.buckets.actionable : []),
      ...(Array.isArray(assignments.buckets.pending) ? assignments.buckets.pending : []),
      ...(Array.isArray(assignments.buckets.ignored) ? assignments.buckets.ignored : []),
    ];
  }
  return [];
}

function latestAssignmentListExecution(executed = []) {
  for (let i = executed.length - 1; i >= 0; i -= 1) {
    const entry = executed[i];
    if (entry?.call?.name !== "list_assignments") continue;
    const rows = flattenAssignmentOutput(entry?.output?.assignments);
    if (rows.length > 0) {
      return {
        rows,
        args: entry?.call?.arguments || {},
      };
    }
  }
  return null;
}

function parseNumberedLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?(\d{1,3})[\.)]\s+(.+?)\s*$/);
    if (!match) continue;
    parsed.push({
      index: Number(match[1]),
      text: match[2],
      normalized: normalizeMatchText(match[2]),
    });
  }
  return parsed;
}

function scoreNumberedLineMatch(numbered, assignment) {
  const title = normalizeMatchText(assignment.title || "");
  const course = normalizeMatchText(assignment.course || "");
  const url = normalizeMatchText(assignment.url || "");
  if (!numbered.normalized || !title) return 0;
  let score = 0;
  if (numbered.normalized.includes(title)) score += 100;
  if (title.includes(numbered.normalized)) score += 50;
  const titleTokens = new Set(title.split(" ").filter((token) => token.length >= 3));
  const lineTokens = numbered.normalized.split(" ").filter((token) => token.length >= 3);
  let overlap = 0;
  for (const token of lineTokens) {
    if (titleTokens.has(token)) overlap += 1;
  }
  score += overlap * 4;
  if (course && numbered.normalized.includes(course)) score += 20;
  if (url && numbered.normalized.includes(url)) score += 20;
  return score;
}

function matchNumberedLinesToAssignments(numberedLines, rows) {
  const assignments = rows.map((row, idx) => assignmentFromRow(row, idx + 1));
  const usedKeys = new Set();
  const matches = [];
  for (const numbered of numberedLines) {
    let best = null;
    let bestScore = 0;
    for (const assignment of assignments) {
      const identity = assignment.key || `${assignment.title}|${assignment.course}`;
      if (usedKeys.has(identity)) continue;
      const score = scoreNumberedLineMatch(numbered, assignment);
      if (score > bestScore) {
        best = assignment;
        bestScore = score;
      }
    }
    if (!best || bestScore < 12) continue;
    usedKeys.add(best.key || `${best.title}|${best.course}`);
    matches.push({ ...best, index: numbered.index, displayText: compactText(numbered.text, 240) });
  }
  return matches.sort((a, b) => a.index - b.index);
}

export function buildAssignmentListContextFromTurn({ executed = [], reply = "" } = {}) {
  const latest = latestAssignmentListExecution(executed);
  if (!latest) return null;
  const numbered = parseNumberedLines(reply);
  const matched = matchNumberedLinesToAssignments(numbered, latest.rows);
  const toolItems = latest.rows
    .slice(0, MAX_CONTEXT_ASSIGNMENTS)
    .map((row, idx) => assignmentFromRow(row, idx + 1));

  return {
    source: matched.length > 0 ? "assistant_reply" : "tool_result",
    capturedAt: new Date().toISOString(),
    query: {
      status: latest.args?.status || "missing",
      course: latest.args?.course || null,
      bucketed: latest.args?.bucketed === true,
      includeIgnored: latest.args?.includeIgnored === true,
      includePending: latest.args?.includePending !== false,
    },
    items: matched.length > 0 ? matched.slice(0, MAX_CONTEXT_ASSIGNMENTS) : toolItems,
    fallbackItems: matched.length > 0 ? toolItems : [],
  };
}

export function recordDisplayedAssignmentListContext(
  db,
  { chatId, executed = [], reply = "", ttlHours = DEFAULT_CONTEXT_TTL_HOURS } = {}
) {
  if (!chatId) return { ok: false, error: "Chat id is required." };
  const payload = buildAssignmentListContextFromTurn({ executed, reply });
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, error: "No assignment list context found." };
  }
  return setConversationContext(db, {
    chatId,
    type: CONTEXT_TYPES.ASSIGNMENT_LIST,
    payload,
    ttlHours,
  });
}

function assignmentKeysFromIssueBody(body, assignmentContext) {
  const text = normalizeMatchText(body);
  const items = Array.isArray(assignmentContext?.payload?.items) ? assignmentContext.payload.items : [];
  const keys = [];
  for (const item of items) {
    const title = normalizeMatchText(item.title || "");
    const url = normalizeMatchText(item.url || "");
    if ((title && text.includes(title)) || (url && text.includes(url))) {
      keys.push(item.key);
    }
  }
  return Array.from(new Set(keys.filter(Boolean)));
}

export function recordCreatedIssueContext(
  db,
  { chatId, args = {}, output = {}, userText = "", ttlHours = DEFAULT_CONTEXT_TTL_HOURS } = {}
) {
  if (!chatId) return { ok: false, error: "Chat id is required." };
  const issue = output?.issue && typeof output.issue === "object" ? output.issue : {};
  const number = issue.number || null;
  const url = issue.url || "";
  if (!number && !url && output?.logged !== true) {
    return { ok: false, error: "No created issue context found." };
  }
  const assignmentContext = getConversationContext(db, chatId, CONTEXT_TYPES.ASSIGNMENT_LIST);
  const body = String(args?.body || "").trim();
  return setConversationContext(db, {
    chatId,
    type: CONTEXT_TYPES.CREATED_ISSUE,
    payload: {
      kind: "bug",
      number,
      url,
      title: compactText(args?.title || "", 180),
      bodySummary: compactText(body, 800),
      labels: Array.isArray(args?.labels) ? args.labels.map((label) => String(label || "").trim()).filter(Boolean) : [],
      sourceUserText: compactText(userText, 400),
      linkedAssignmentKeys: assignmentKeysFromIssueBody(body, assignmentContext),
      createdAt: new Date().toISOString(),
      issueOk: issue.ok === true,
      logged: output?.logged === true,
    },
    ttlHours,
  });
}

export function getDisplayedAssignmentByIndex(db, chatId, index) {
  const context = getConversationContext(db, chatId, CONTEXT_TYPES.ASSIGNMENT_LIST);
  const numericIndex = Number(index);
  if (!context || !Number.isFinite(numericIndex) || numericIndex < 1) return null;
  const items = Array.isArray(context.payload?.items) ? context.payload.items : [];
  return items.find((item) => Number(item?.index) === numericIndex) || null;
}

export function buildShortLivedConversationContextPrompt(db, chatId, { now = new Date().toISOString() } = {}) {
  const contexts = listConversationContexts(db, chatId, { now });
  if (contexts.length === 0) return "";
  const assignmentList = contexts.find((entry) => entry.type === CONTEXT_TYPES.ASSIGNMENT_LIST);
  const issue = contexts.find((entry) => entry.type === CONTEXT_TYPES.CREATED_ISSUE);
  const payload = {};
  if (assignmentList?.payload?.items?.length) {
    payload.lastDisplayedAssignmentList = {
      source: assignmentList.payload.source || "unknown",
      query: assignmentList.payload.query || {},
      expiresAt: assignmentList.expiresAt,
      items: assignmentList.payload.items.slice(0, MAX_PROMPT_ASSIGNMENTS),
    };
  }
  if (issue?.payload) {
    payload.lastCreatedIssue = {
      ...issue.payload,
      expiresAt: issue.expiresAt,
    };
  }
  if (Object.keys(payload).length === 0) return "";
  return [
    "Short-lived current-thread context. Use this for recent references like numbered assignments, 'that bug', or corrections to the issue just filed. This is operational context, not durable memory.",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
