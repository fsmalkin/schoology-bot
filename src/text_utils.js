function collapseRepeatedSentences(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const result = [];
  let last = "";
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed === last) continue;
    result.push(sentence);
    last = trimmed;
  }
  return result.join(" ");
}

export function sanitizeRepeatedText(text) {
  if (!text) return text;
  let cleaned = String(text).replace(/\r/g, "").trim();

  const lines = cleaned.split("\n");
  const result = [];
  let last = "";
  for (const line of lines) {
    const normalizedLine = collapseRepeatedSentences(line);
    const norm = normalizedLine.trim();
    if (norm && norm === last) {
      continue;
    }
    result.push(normalizedLine);
    if (norm) last = norm;
  }

  return result.join("\n").trim();
}
