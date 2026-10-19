import { buildCurrentSummary, CURRENT_SNAPSHOT_FORMAT, CurrentSnapshotError } from "../../src/current_summary.js";

export const QUALIFIED_CURRENT_TERM_FORMAT = "schoology-qualified-current-term/v1";
export const MAX_TOOL_RESULT_BYTES = 48 * 1024;
export const MAX_TOOL_ITEMS = 50;
const SOURCE_ORIGIN = "https://bcps.schoology.com";
const bytes = new TextEncoder();

export const currentTermSummaryToolDefinition = Object.freeze({
  name: "get_current_term_summary",
  title: "Read current-term schoolwork",
  description: "Read missing or incomplete schoolwork for the connected student's current term. Takes no arguments. Returns unavailable when qualified current data is absent; does not refresh or change schoolwork.",
  inputSchema: Object.freeze({ type: "object", properties: Object.freeze({}), additionalProperties: false }),
  annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }),
});

function unavailable(reason) {
  const message = reason === "arguments_not_supported"
    ? "This tool takes no arguments."
    : "Current-term Schoology data is unavailable; no current summary was produced.";
  return { isError: true, structuredContent: { status: "unavailable", reason, message }, content: [{ type: "text", text: message }] };
}

function noArguments(args) {
  return args === undefined || (
    args !== null && typeof args === "object" && !Array.isArray(args) &&
    Object.getPrototypeOf(args) === Object.prototype && Reflect.ownKeys(args).length === 0
  );
}

function boundedText(value, limit, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > limit || value.includes("\0") || (required && !value.trim())) {
    throw new CurrentSnapshotError("Invalid current field.");
  }
  return value;
}

function qualifiedInput(envelope) {
  if (
    !envelope || envelope.format !== QUALIFIED_CURRENT_TERM_FORMAT ||
    envelope.subjectVerified !== true || envelope.currentTermVerified !== true ||
    !envelope.currentTerm || !envelope.snapshot ||
    envelope.snapshot.sourceOrigin !== SOURCE_ORIGIN
  ) return null;
  const id = boundedText(envelope.currentTerm.id, 80, true).trim();
  const label = boundedText(envelope.currentTerm.label, 80, true).trim();
  if (/[\r\n]/.test(id + label)) throw new CurrentSnapshotError("Invalid current term.");
  const snapshot = envelope.snapshot;
  if (snapshot.format !== CURRENT_SNAPSHOT_FORMAT || !Array.isArray(snapshot.assignments) || snapshot.assignments.length > 1000) {
    throw new CurrentSnapshotError("Invalid current snapshot.");
  }
  // Copy only the approved source fields before calling the existing pure code.
  // The host reader must already bind every row to its authenticated subject
  // and current term. These declarations are not independent live proof.
  const assignments = snapshot.assignments.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new CurrentSnapshotError("Invalid current row.");
    return {
      course: boundedText(row.course, 160, true),
      title: boundedText(row.title, 400, true),
      dueDate: boundedText(row.dueDate, 100),
      status: boundedText(row.status, 160),
      isMissing: row.isMissing,
      url: boundedText(row.url, 2048),
    };
  });
  return {
    label,
    snapshot: { format: CURRENT_SNAPSHOT_FORMAT, sourceOrigin: SOURCE_ORIGIN, observedAt: snapshot.observedAt, complete: snapshot.complete, assignments },
  };
}

function approvedItem(row) {
  return { course: row.course, title: row.title, dueDate: row.dueDate, status: row.status, isMissing: row.isMissing, url: row.url };
}

function readyResult(summary, label) {
  const items = summary.missing.slice(0, MAX_TOOL_ITEMS).map(approvedItem);
  function response() {
    const omittedCount = summary.missing.length - items.length;
    const text = [
      `Current term: ${label}`,
      summary.complete ? "Complete current Schoology snapshot." : "Partial Schoology view; other rows may be missing.",
      `Missing: ${summary.missing.length}. Submitted work: ${summary.submittedAwaitingGrade + summary.submittedGradingUnknown} (excluded from missing work).`,
      `Awaiting grade: ${summary.submittedAwaitingGrade}. Submission confirmed, grading status unknown: ${summary.submittedGradingUnknown}.`,
      !summary.missing.length ? (summary.complete
        ? "No missing assignments in this complete current Schoology snapshot."
        : "No missing assignments visible in the captured rows; coverage is incomplete.") : "",
      ...items.map((item, index) => [
        `${index + 1}. ${item.course}: ${item.title}`,
        `Due: ${item.dueDate || "Not listed"} | Status: ${item.status || "Missing"}`,
        item.url,
      ].filter(Boolean).join("\n")),
      omittedCount ? `Returned ${items.length} of ${summary.missing.length} missing items; ${omittedCount} omitted to bound this response.` : "",
      "Saved exceptions, notes and reminder history are not included.",
    ].filter(Boolean).join("\n");
    return {
      isError: false,
      structuredContent: {
        status: "ready", currentTerm: { label }, observedAt: summary.observedAt,
        sourceComplete: summary.complete, missingCount: summary.missing.length,
        submittedExcludedCount: summary.submittedAwaitingGrade + summary.submittedGradingUnknown, returnedCount: items.length, omittedCount, items,
      },
      content: [{ type: "text", text }],
    };
  }
  let result = response();
  while (bytes.encode(JSON.stringify(result)).length > MAX_TOOL_RESULT_BYTES && items.length) {
    items.pop(); result = response();
  }
  return bytes.encode(JSON.stringify(result)).length <= MAX_TOOL_RESULT_BYTES ? result : unavailable("result_too_large");
}

// Transport-neutral, no default file/store/session/network reader. Construct
// inside the host's authorized subject/request context; never use model args
// to select a student, account, term, URL, path, command or write operation.
export function createCurrentTermSummaryTool({ readCurrentTermSnapshot, now = () => new Date(), timeZone = "America/New_York" } = {}) {
  return Object.freeze({
    definition: currentTermSummaryToolDefinition,
    async call(args) {
      if (!noArguments(args)) return unavailable("arguments_not_supported");
      if (typeof readCurrentTermSnapshot !== "function") return unavailable("source_unavailable");
      let envelope;
      try { envelope = await readCurrentTermSnapshot(); }
      catch { return unavailable("source_unavailable"); }
      try {
        const input = qualifiedInput(envelope);
        if (!input) return unavailable("unverified_current_scope");
        // Evaluate freshness after the reader completes, never before a slow read.
        const summary = buildCurrentSummary(input.snapshot, { now: now(), timeZone });
        return readyResult(summary, input.label);
      } catch (error) {
        return unavailable(error instanceof CurrentSnapshotError && error.message.includes("older than 15 minutes") ? "stale_snapshot" : "invalid_snapshot");
      }
    },
  });
}
