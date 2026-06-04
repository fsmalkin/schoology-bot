export const STATUS_CODE_MAP = {
  A: "Excused (doesn't count)",
  B: "Practice / not for grade",
  C: "No way to fix it",
  D: "No grade put in yet",
  E: "Waiting on teacher",
  F: "Will complete in class",
};

export const MANUAL_STATUSES = Object.values(STATUS_CODE_MAP);

export const STATUS_CATEGORY = {
  ACTIONABLE: "actionable",
  PENDING: "pending",
  IGNORED: "ignored",
};

const IGNORED_STATUSES = new Set([STATUS_CODE_MAP.A, STATUS_CODE_MAP.B, STATUS_CODE_MAP.C]);
const MANUAL_SUBMITTED_STATUS = "Submitted";
const PENDING_STATUSES = new Set([
  STATUS_CODE_MAP.D,
  STATUS_CODE_MAP.E,
  STATUS_CODE_MAP.F,
  MANUAL_SUBMITTED_STATUS,
]);
const STATUS_ALIAS_MAP = new Map([
  ["submitted", MANUAL_SUBMITTED_STATUS],
  ["turned in", MANUAL_SUBMITTED_STATUS],
  ["turn in complete", MANUAL_SUBMITTED_STATUS],
  ["no action needed", STATUS_CODE_MAP.C],
  ["no action", STATUS_CODE_MAP.C],
  ["nothing needed", STATUS_CODE_MAP.C],
  ["not needed", STATUS_CODE_MAP.C],
  ["ignore", STATUS_CODE_MAP.C],
  ["ignored", STATUS_CODE_MAP.C],
]);

const SUBMITTED_AWAITING_GRADE_TEXT = [
  "submitted, awaiting grade",
  "submission that has not been graded",
  "assignment submitted",
];

export function normalizeManualStatus(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const code = raw.toUpperCase();
  if (STATUS_CODE_MAP[code]) return STATUS_CODE_MAP[code];
  const alias = STATUS_ALIAS_MAP.get(raw.toLowerCase().replace(/\s+/g, " "));
  if (alias) return alias;
  return raw;
}

export function getManualStatusCategory(value) {
  const normalized = normalizeManualStatus(value);
  if (!normalized) return STATUS_CATEGORY.ACTIONABLE;
  if (IGNORED_STATUSES.has(normalized)) return STATUS_CATEGORY.IGNORED;
  if (PENDING_STATUSES.has(normalized)) return STATUS_CATEGORY.PENDING;
  return STATUS_CATEGORY.ACTIONABLE;
}

export function isIgnoredStatus(value) {
  return getManualStatusCategory(value) === STATUS_CATEGORY.IGNORED;
}

export function isPendingStatus(value) {
  return getManualStatusCategory(value) === STATUS_CATEGORY.PENDING;
}

function normalizeStatusText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getSubmittedSchoologyStatusLabel(row = {}) {
  const status = String(row?.status || "").trim();
  const rawText = String(row?.rawText || row?.raw_text || "").trim();
  const lowerStatus = normalizeStatusText(status);
  const haystack = normalizeStatusText(`${status} ${rawText}`);

  if (
    lowerStatus === "submitted" ||
    lowerStatus.startsWith("submitted,") ||
    lowerStatus.startsWith("submitted (") ||
    lowerStatus.startsWith("submitted -")
  ) {
    return status || "Submitted";
  }
  if (SUBMITTED_AWAITING_GRADE_TEXT.some((needle) => haystack.includes(needle))) {
    return "Submitted, awaiting grade";
  }
  return "";
}

export function isSubmittedSchoologyStatus(row = {}) {
  return Boolean(getSubmittedSchoologyStatusLabel(row));
}

export function statusGuideText() {
  return Object.entries(STATUS_CODE_MAP)
    .map(([code, label]) => `${code} = ${label}`)
    .join("; ");
}
