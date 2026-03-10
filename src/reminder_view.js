import { normalizeRecurrenceKind } from "./db.js";
import { formatDateTime, formatDateTimeLabel, formatIsoWithOffset } from "./time.js";

function recurrenceLabelFor(kind) {
  if (kind === "daily") return "Daily";
  if (kind === "weekdays") return "Weekdays";
  if (kind === "weekly") return "Weekly";
  return "One-time";
}

export function addLocalReminderFields(item, timeZone) {
  const recurrenceCheck = normalizeRecurrenceKind(item?.recurrenceKind, { allowNull: true });
  const recurrenceKind = recurrenceCheck.ok ? recurrenceCheck.value || "none" : "none";
  const recurrenceLabel = recurrenceLabelFor(recurrenceKind);
  if (!item || !item.remindAt) {
    return {
      ...item,
      remindAtUtc: item?.remindAt || null,
      remindAtLocal: null,
      remindAtLabel: null,
      remindAtTz: timeZone,
      recurrenceKind,
      recurrenceLabel,
    };
  }
  const parsed = new Date(item.remindAt);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      ...item,
      remindAtUtc: item?.remindAt || null,
      remindAtLocal: null,
      remindAtLabel: null,
      remindAtTz: timeZone,
      recurrenceKind,
      recurrenceLabel,
    };
  }
  const localIso = formatIsoWithOffset(parsed, timeZone);
  const utcIso = parsed.toISOString().replace(".000Z", "Z");
  return {
    ...item,
    remindAtUtc: utcIso,
    remindAt: localIso,
    remindAtLocal: formatDateTime(parsed, timeZone),
    remindAtLabel: formatDateTimeLabel(parsed, timeZone),
    remindAtTz: timeZone,
    recurrenceKind,
    recurrenceLabel,
  };
}

export function addLocalReminderFieldsToList(items, timeZone) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => addLocalReminderFields(item, timeZone));
}

export function recurrenceOptionList() {
  return [
    { value: "none", label: "One-time" },
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
  ];
}
