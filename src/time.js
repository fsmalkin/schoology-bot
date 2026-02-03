export function nowIso() {
  return new Date().toISOString();
}

export function formatDateYmd(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatTimeHm(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDateTime(date, timeZone) {
  const d = formatDateYmd(date, timeZone);
  const t = formatTimeHm(date, timeZone);
  return `${d} ${t}`;
}
