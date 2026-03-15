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

export function isToolingLoop(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  if (lower.includes("stuck in loop")) return true;
  if (lower.includes("tool call") || lower.includes("function call")) return true;

  const tokens = ["ok", "let's", "call", "tool", "function", "json", "schema", "proceed"];
  let count = 0;
  for (const token of tokens) {
    const matches = lower.match(new RegExp(`\\b${token}\\b`, "g"));
    if (matches) count += matches.length;
  }

  const okMatches = lower.match(/\bok\b/g);
  const okCount = okMatches ? okMatches.length : 0;
  if (okCount >= 6) return true;

  if (count >= 8 && (lower.includes("call") || lower.includes("tool") || lower.includes("function"))) {
    return true;
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

export function normalizeAscii(text) {
  if (!text) return text;
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

function normalizeCompactText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function cleanSchoologyTitleCandidate(text) {
  return normalizeCompactText(text)
    .replace(/\s*Note:\s*.*$/i, "")
    .replace(/[\s.:-]*(assignment|test-quiz|external-tool-link|discussion)$/i, "")
    .trim();
}

function earliestMatchIndex(text, patterns) {
  let earliest = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (earliest === -1 || match.index < earliest) {
      earliest = match.index;
    }
  }
  return earliest;
}

export function deriveSchoologyAssignmentTitle({ title = "", titleText = "", rawText = "" } = {}) {
  const directTitle = cleanSchoologyTitleCandidate(title);
  if (directTitle) return directTitle;

  const visibleTitle = cleanSchoologyTitleCandidate(titleText);
  if (visibleTitle) return visibleTitle;

  const normalizedRawText = normalizeCompactText(rawText);
  if (!normalizedRawText) return "";

  const cutoff = earliestMatchIndex(normalizedRawText, [
    /\s*Note:\s*/i,
    /\s*(assignment|test-quiz|external-tool-link|discussion)\s+Due\b/i,
    /\s+Due\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i,
    /\s+Comment:\s*/i,
    /\s+No comment\b/i,
    /\s+Offered\/Received accommodation\b/i,
    /\s+\d+\s*\/\s*\d+\b/i,
  ]);

  return cleanSchoologyTitleCandidate(cutoff >= 0 ? normalizedRawText.slice(0, cutoff) : normalizedRawText);
}
