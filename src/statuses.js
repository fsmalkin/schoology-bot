export const STATUS_CODE_MAP = {
  A: "Excused (doesn't count)",
  B: "Practice / not for grade",
  C: "No way to fix it",
  D: "No grade put in yet",
  E: "Waiting on teacher",
};

export const MANUAL_STATUSES = Object.values(STATUS_CODE_MAP);

export function normalizeManualStatus(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const code = raw.toUpperCase();
  if (STATUS_CODE_MAP[code]) return STATUS_CODE_MAP[code];
  return raw;
}

export function statusGuideText() {
  return Object.entries(STATUS_CODE_MAP)
    .map(([code, label]) => `${code} = ${label}`)
    .join("; ");
}
