const SECRET_KEY_RE =
  /(api[_-]?key|authorization|bearer|cookie|credential|password|secret|session[_-]?token|token)/i;
const DEFAULT_MAX_STRING_CHARS = 300;
const MAX_METADATA_KEYS = 40;
const MAX_METADATA_ITEMS = 20;

function truncateString(value, maxChars = DEFAULT_MAX_STRING_CHARS) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

export function redactSensitiveString(value, maxChars = DEFAULT_MAX_STRING_CHARS) {
  let text = String(value || "");
  text = text.replace(
    /\b([A-Z0-9_]*(?:API[_-]?KEY|AUTHORIZATION|BEARER|COOKIE|CREDENTIAL|PASSWORD|SECRET|SESSION[_-]?TOKEN|TOKEN)[A-Z0-9_]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1=[redacted]"
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
  text = text.replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, "sk-[redacted]");
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/gi, "xox-[redacted]");
  text = text.replace(/\bbot\d{5,}:[A-Za-z0-9_-]{10,}/gi, "bot[redacted]");
  text = text.replace(
    /\b(password|secret|token|api\s*key|apikey)\s+(?:is\s+|was\s+)?("[^"]*"|'[^']*'|[A-Za-z0-9._~+/=-]{4,})/gi,
    "$1 [redacted]"
  );
  return truncateString(text, maxChars);
}

export function sanitizeForLocalLog(value, depth = 0) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return redactSensitiveString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: redactSensitiveString(value.name || "Error", 80),
      message: redactSensitiveString(value.message || String(value)),
    };
  }
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_METADATA_ITEMS)
      .map((item) => sanitizeForLocalLog(item, depth + 1));
    if (value.length > MAX_METADATA_ITEMS) {
      items.push({ truncatedItems: value.length - MAX_METADATA_ITEMS });
    }
    return items;
  }
  if (typeof value === "object") {
    const next = {};
    const entries = Object.entries(value).slice(0, MAX_METADATA_KEYS);
    for (const [key, child] of entries) {
      if (SECRET_KEY_RE.test(key)) {
        next[key] = "[redacted]";
        continue;
      }
      next[key] = sanitizeForLocalLog(child, depth + 1);
    }
    const extraKeys = Object.keys(value).length - entries.length;
    if (extraKeys > 0) next.truncatedKeys = extraKeys;
    return next;
  }
  return redactSensitiveString(value);
}
