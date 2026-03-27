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
const PENDING_STATUSES = new Set([STATUS_CODE_MAP.D, STATUS_CODE_MAP.E, STATUS_CODE_MAP.F]);

export function normalizeManualStatus(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const code = raw.toUpperCase();
  if (STATUS_CODE_MAP[code]) return STATUS_CODE_MAP[code];
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

export function statusGuideText() {
  return Object.entries(STATUS_CODE_MAP)
    .map(([code, label]) => `${code} = ${label}`)
    .join("; ");
}
