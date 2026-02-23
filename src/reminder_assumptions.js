import { normalizeRecurrenceKind } from "./db.js";
import {
  formatDateTimeLabel,
  formatIsoWithOffset,
  getLocalDateTimeParts,
  makeDateInZoneParts,
  shiftYmdParts,
} from "./time.js";

const DEFAULT_TIMEZONE = "America/New_York";

const MORNING_TIME = { hour: 7, minute: 0 };
const FOLLOW_UP_TIME = { hour: 16, minute: 30 };
const FALLBACK_TIME = { hour: 21, minute: 0 };

const RECURRENCE_LABELS = {
  none: "One-time",
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
};

const UNSUPPORTED_RECURRENCE_PATTERNS = [
  { regex: /\b(monthly|every month|each month)\b/i, label: "monthly" },
  { regex: /\b(yearly|annually|every year|each year)\b/i, label: "yearly" },
  { regex: /\b(biweekly|every other week)\b/i, label: "biweekly" },
  { regex: /\b(quarterly|every quarter)\b/i, label: "quarterly" },
  { regex: /\bevery\s+\d+\s+(day|days|week|weeks|month|months)\b/i, label: "custom interval" },
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function recurrenceLabel(kind) {
  return RECURRENCE_LABELS[kind] || RECURRENCE_LABELS.none;
}

function localWeekday(date, timeZone) {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(date)
    .slice(0, 3)
    .toLowerCase();
  const map = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return map[short] ?? null;
}

function detectUnsupportedCadence(text) {
  for (const entry of UNSUPPORTED_RECURRENCE_PATTERNS) {
    if (entry.regex.test(text)) return entry;
  }
  return null;
}

function inferRecurrenceFromText(text) {
  if (!text) return null;
  if (/\b(weekday|weekdays|every weekday|every school day|school days|workdays?)\b/i.test(text)) {
    return {
      kind: "weekdays",
      reason: "Used weekdays from your frequency cue.",
    };
  }
  if (/\b(daily|every day|each day|everyday)\b/i.test(text)) {
    return {
      kind: "daily",
      reason: "Used daily from your frequency cue.",
    };
  }
  if (
    /\b(weekly|every week|each week|every\s+(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday))\b/i.test(
      text
    )
  ) {
    return {
      kind: "weekly",
      reason: "Used weekly from your frequency cue.",
    };
  }
  if (/\b(recurring|repeat|repeating|on a schedule)\b/i.test(text)) {
    return {
      kind: "weekdays",
      reason: "You asked for recurring reminders without a cadence, so weekdays was used.",
    };
  }
  return null;
}

function inferTimeSlotFromText(text) {
  if (
    /\b(morning|before school|school start|start of school|homeroom|first period)\b/i.test(text)
  ) {
    return {
      hour: MORNING_TIME.hour,
      minute: MORNING_TIME.minute,
      reason:
        "No time was provided, so 7:00 AM ET was used for a morning/school-start cue.",
    };
  }
  if (
    /\b(check[\s-]?in|follow[\s-]?up|after school|after-school|end of day|afternoon)\b/i.test(text)
  ) {
    return {
      hour: FOLLOW_UP_TIME.hour,
      minute: FOLLOW_UP_TIME.minute,
      reason: "No time was provided, so 4:30 PM ET was used for a check-in/follow-up cue.",
    };
  }
  return {
    hour: FALLBACK_TIME.hour,
    minute: FALLBACK_TIME.minute,
    reason: "No time was provided, so 9:00 PM ET was used as the default.",
  };
}

function buildDateFromSlot({ recurrenceKind, slot, timeZone, now }) {
  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const nowDate = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const nowParts = getLocalDateTimeParts(nowDate, tz);
  if (!nowParts) return new Date(nowDate.getTime() + 24 * 60 * 60 * 1000);

  const sameDay = makeDateInZoneParts(
    {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: slot.hour,
      minute: slot.minute,
    },
    tz
  );
  if (recurrenceKind === "weekdays") {
    for (let offset = 0; offset <= 8; offset += 1) {
      const dayParts = shiftYmdParts(nowParts, offset);
      if (!dayParts) continue;
      const candidate = makeDateInZoneParts(
        {
          year: dayParts.year,
          month: dayParts.month,
          day: dayParts.day,
          hour: slot.hour,
          minute: slot.minute,
        },
        tz
      );
      const weekday = localWeekday(candidate, tz);
      if (weekday === 0 || weekday === 6) continue;
      if (candidate > nowDate) return candidate;
    }
  }

  if (sameDay > nowDate) return sameDay;
  const tomorrowParts = shiftYmdParts(nowParts, 1);
  if (!tomorrowParts) return new Date(nowDate.getTime() + 24 * 60 * 60 * 1000);
  return makeDateInZoneParts(
    {
      year: tomorrowParts.year,
      month: tomorrowParts.month,
      day: tomorrowParts.day,
      hour: slot.hour,
      minute: slot.minute,
    },
    tz
  );
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function mapUnsupportedRecurrence(rawValue) {
  const text = normalizeText(rawValue);
  if (!text) return null;
  const unsupported = detectUnsupportedCadence(text);
  if (!unsupported) return null;
  return {
    kind: "weekly",
    reason: `${unsupported.label} cadence is not supported yet, so weekly was used.`,
    warning: `Unsupported cadence "${unsupported.label}" was requested; weekly fallback applied.`,
  };
}

function buildAssumption(field, kind, reason, extra = {}) {
  return {
    field,
    kind,
    reason,
    ...extra,
  };
}

export function applyReminderAssumptions({
  args,
  userText,
  timeZone,
  now = new Date(),
  allowCreateDefaults = false,
} = {}) {
  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const nextArgs = args && typeof args === "object" ? { ...args } : {};
  const assumptions = [];
  const warnings = [];
  const context = [userText, nextArgs.title, nextArgs.message].filter(Boolean).join(" ").trim();
  const unsupportedContextCadence = detectUnsupportedCadence(context);

  let recurrenceKind = null;
  if (hasValue(nextArgs.recurrence)) {
    const recurrenceCheck = normalizeRecurrenceKind(nextArgs.recurrence);
    if (recurrenceCheck.ok) {
      recurrenceKind = recurrenceCheck.value;
      nextArgs.recurrence = recurrenceKind;
      const unsupportedRecurrenceArg = detectUnsupportedCadence(String(nextArgs.recurrence || ""));
      if (
        unsupportedContextCadence &&
        !unsupportedRecurrenceArg &&
        recurrenceKind === "weekly"
      ) {
        const reason = `${unsupportedContextCadence.label} cadence is not supported yet, so weekly was used.`;
        const warning = `Unsupported cadence "${unsupportedContextCadence.label}" was requested; weekly fallback applied.`;
        warnings.push(warning);
        assumptions.push(
          buildAssumption("recurrence", "fallback", reason, {
            value: recurrenceKind,
            valueLabel: recurrenceLabel(recurrenceKind),
          })
        );
      }
    } else {
      const fallback = mapUnsupportedRecurrence(nextArgs.recurrence);
      if (!fallback) {
        return {
          args: nextArgs,
          assumptions,
          warnings,
          error: recurrenceCheck.error,
        };
      }
      recurrenceKind = fallback.kind;
      nextArgs.recurrence = fallback.kind;
      warnings.push(fallback.warning);
      assumptions.push(
        buildAssumption("recurrence", "fallback", fallback.reason, {
          value: fallback.kind,
          valueLabel: recurrenceLabel(fallback.kind),
        })
      );
    }
  } else {
    const unsupported = detectUnsupportedCadence(context);
    if (unsupported) {
      recurrenceKind = "weekly";
      nextArgs.recurrence = recurrenceKind;
      const reason = `${unsupported.label} cadence is not supported yet, so weekly was used.`;
      warnings.push(`Unsupported cadence "${unsupported.label}" was requested; weekly fallback applied.`);
      assumptions.push(
        buildAssumption("recurrence", "fallback", reason, {
          value: recurrenceKind,
          valueLabel: recurrenceLabel(recurrenceKind),
        })
      );
    } else {
      const inferred = inferRecurrenceFromText(context);
      if (inferred) {
        recurrenceKind = inferred.kind;
        nextArgs.recurrence = inferred.kind;
        assumptions.push(
          buildAssumption("recurrence", "inferred", inferred.reason, {
            value: inferred.kind,
            valueLabel: recurrenceLabel(inferred.kind),
          })
        );
      }
    }
  }

  if (
    recurrenceKind &&
    recurrenceKind !== "none" &&
    !hasValue(nextArgs.recurrenceTz)
  ) {
    nextArgs.recurrenceTz = tz;
  }

  const hasRemindAt = hasValue(nextArgs.remindAt);
  if (allowCreateDefaults && !hasRemindAt && recurrenceKind && recurrenceKind !== "none") {
    const slot = inferTimeSlotFromText(context);
    const date = buildDateFromSlot({
      recurrenceKind,
      slot,
      timeZone: tz,
      now,
    });
    nextArgs.remindAt = formatIsoWithOffset(date, tz);
    assumptions.push(
      buildAssumption("remindAt", "default_time", slot.reason, {
        value: nextArgs.remindAt,
        valueLabel: formatDateTimeLabel(date, tz),
      })
    );
  }

  return {
    args: nextArgs,
    assumptions,
    warnings,
    error: null,
  };
}
