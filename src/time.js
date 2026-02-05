const DEFAULT_TIMEZONE = "America/New_York";

function withDefaultZone(timeZone) {
  return timeZone && String(timeZone).trim().length > 0 ? timeZone : DEFAULT_TIMEZONE;
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatDateYmd(date, timeZone) {
  const tz = withDefaultZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatTimeHm(date, timeZone) {
  const tz = withDefaultZone(timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
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

function getTimeZoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - date.getTime();
}

function makeDateInZone({ year, month, day, hour, minute }, timeZone) {
  const tz = withDefaultZone(timeZone);
  const utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const date = new Date(utc);
  const offset = getTimeZoneOffset(date, tz);
  return new Date(utc - offset);
}

export function parseSchoologyDate(value, timeZone) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i
  );
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  let hour = match[4] ? Number(match[4]) : 23;
  const minute = match[5] ? Number(match[5]) : 59;
  const ampm = match[6] ? match[6].toLowerCase() : "";
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return makeDateInZone({ year, month, day, hour, minute }, timeZone);
}
