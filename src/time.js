import * as chrono from "chrono-node";

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

export function formatIsoWithOffset(date, timeZone) {
  const tz = withDefaultZone(timeZone);
  const datePart = formatDateYmd(date, tz);
  const timePart = formatTimeHm(date, tz);
  const offsetMinutes = getTimeZoneOffset(date, tz) / 60000;
  const sign = offsetMinutes <= 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(Math.floor(abs % 60)).padStart(2, "0");
  return `${datePart}T${timePart}:00${sign}${hours}:${minutes}`;
}

export function formatDateTimeLabel(date, timeZone) {
  const tz = withDefaultZone(timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

export function getLocalDateTimeParts(date, timeZone) {
  if (!date) return null;
  const tz = withDefaultZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
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

export function getLocalDateParts(date, timeZone) {
  if (!date) return null;
  const tz = withDefaultZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

export function makeDateInZoneParts({ year, month, day, hour, minute }, timeZone) {
  return makeDateInZone({ year, month, day, hour, minute }, timeZone);
}

export function shiftYmdParts(parts, days) {
  if (!parts) return null;
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
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

function parseShorthandTime(raw) {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!cleaned) return null;

  const match = cleaned.match(/^(\d{1,4})([ap]m?|[ap]l)?$/);
  if (!match) return null;

  const digits = match[1];
  const suffix = match[2] || "";
  let hour = 0;
  let minute = 0;

  if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else if (digits.length === 3) {
    hour = Number(digits.slice(0, 1));
    minute = Number(digits.slice(1));
  } else {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  let meridiem = null;
  if (suffix.startsWith("p")) meridiem = "pm";
  if (suffix.startsWith("a")) meridiem = "am";
  if (suffix === "pl") meridiem = "pm";
  if (suffix === "al") meridiem = "am";

  return { hour, minute, meridiem };
}

export function parseReminderTime(input, timeZone, now = new Date()) {
  const text = String(input || "").trim();
  if (!text) {
    return { ok: false, error: "Reminder time is required." };
  }

  const numericOnly = /^\d{1,4}$/.test(text);
  if (!numericOnly) {
    // A datetime-local string (e.g. "2026-03-20T12:00" from an HTML datetime-local
    // input) has no timezone offset. Interpret it in the configured timezone rather
    // than the server's local time, which may differ.
    const localDtMatch = text.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
    );
    if (localDtMatch) {
      const date = makeDateInZone(
        {
          year: Number(localDtMatch[1]),
          month: Number(localDtMatch[2]),
          day: Number(localDtMatch[3]),
          hour: Number(localDtMatch[4]),
          minute: Number(localDtMatch[5]),
        },
        withDefaultZone(timeZone)
      );
      if (date && Number.isFinite(date.getTime())) {
        return { ok: true, date, assumption: null };
      }
    }

    const direct = new Date(text);
    if (Number.isFinite(direct.getTime())) {
      return { ok: true, date: direct, assumption: null };
    }
  }

  const tz = withDefaultZone(timeZone);
  const nowParts = getLocalDateTimeParts(now, tz);
  // Use the local Date constructor with Eastern time values so chrono's internal
  // getHours()/getDate() calls return Eastern values on any server timezone.
  const base = nowParts
    ? new Date(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute)
    : now;
  const results = chrono.parse(text, base, { forwardDate: true });
  if (results && results.length > 0) {
    const start = results[0].start;
    const chronoDate = start?.date();
    if (chronoDate && Number.isFinite(chronoDate.getTime())) {
      let assumption = null;
      if (!start.isCertain("meridiem")) {
        assumption = "Assumed PM when meridiem was not specified.";
      }
      // chrono built its result using local time, which contains Eastern values
      // (because we seeded it with Eastern values via the local constructor).
      // Extract those local-time parts and convert to the correct UTC instant.
      const date = makeDateInZone(
        {
          year: chronoDate.getFullYear(),
          month: chronoDate.getMonth() + 1,
          day: chronoDate.getDate(),
          hour: chronoDate.getHours(),
          minute: chronoDate.getMinutes(),
        },
        tz
      );
      return { ok: true, date, assumption };
    }
  }

  const shorthand = parseShorthandTime(text);
  if (shorthand && nowParts) {
    const baseParts = { ...nowParts };
    const dayParts = { year: baseParts.year, month: baseParts.month, day: baseParts.day };
    const buildDate = (hour24) =>
      makeDateInZoneParts({ ...dayParts, hour: hour24, minute: shorthand.minute }, tz);

    const candidates = [];
    if (shorthand.meridiem) {
      let hour = shorthand.hour % 12;
      if (shorthand.meridiem === "pm") hour += 12;
      candidates.push({ date: buildDate(hour), note: `Assumed ${shorthand.meridiem.toUpperCase()}.` });
    } else {
      const am = buildDate(shorthand.hour % 12);
      const pm = buildDate((shorthand.hour % 12) + 12);
      candidates.push({ date: am, note: "Assumed AM." });
      candidates.push({ date: pm, note: "Assumed PM." });
    }

    const nowDate = base;
    const future = candidates.filter((c) => c.date >= nowDate);
    let chosen = future.sort((a, b) => a.date - b.date)[0];
    if (!chosen) {
      const tomorrowParts = shiftYmdParts(dayParts, 1);
      if (tomorrowParts) {
        const hour = shorthand.meridiem === "pm" ? (shorthand.hour % 12) + 12 : shorthand.hour % 12;
        const date = makeDateInZoneParts(
          { ...tomorrowParts, hour, minute: shorthand.minute },
          tz
        );
        chosen = { date, note: "Assumed next day." };
      }
    }

    if (chosen && chosen.date && Number.isFinite(chosen.date.getTime())) {
      return { ok: true, date: chosen.date, assumption: chosen.note };
    }
  }

  return { ok: false, error: "Reminder time is invalid." };
}
