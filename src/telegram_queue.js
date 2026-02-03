export function batchMessages(items, maxChars) {
  if (!Array.isArray(items) || items.length === 0) return "";
  let combined = items.join("\n").trim();
  if (combined.length <= maxChars) return combined;

  const trimmed = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    trimmed.unshift(items[i]);
    const candidate = trimmed.join("\n");
    if (candidate.length > maxChars) {
      trimmed.shift();
      break;
    }
  }
  return trimmed.join("\n").trim();
}
