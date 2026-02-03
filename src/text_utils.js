export function isRepetitiveOutput(text) {
  if (!text) return true;
  const raw = String(text);
  const cleaned = raw.replace(/\r/g, "").trim();
  if (!cleaned) return true;

  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0) {
    const counts = new Map();
    for (const line of lines) {
      counts.set(line, (counts.get(line) || 0) + 1);
    }
    for (const count of counts.values()) {
      if (count >= 4) return true;
    }
  }

  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 0) {
    let repeats = 0;
    let last = "";
    for (const sentence of sentences) {
      if (sentence === last) repeats += 1;
      last = sentence;
    }
    if (repeats >= 2) return true;
  }

  return false;
}

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
