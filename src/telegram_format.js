import { normalizeAscii } from "./text_utils.js";

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(text) {
  let out = String(text || "");
  // Decode ampersand first so double-escaped entities get normalized.
  out = out.replace(/&amp;/gi, "&");
  out = out.replace(/&bull;|&#8226;|&#x2022;/gi, "-");
  out = out.replace(/&nbsp;/gi, " ");
  out = out.replace(/&lt;/gi, "<");
  out = out.replace(/&gt;/gi, ">");
  out = out.replace(/&quot;/gi, "\"");
  out = out.replace(/&#39;/gi, "'");
  return out;
}

function replaceHtmlFormatting(text) {
  let out = String(text || "");
  out = out.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  out = out.replace(/<\/\s*p\s*>/gi, "\n");
  out = out.replace(/<\s*pre\s*>\s*<\s*code\s*>/gi, "```");
  out = out.replace(/<\s*\/\s*code\s*>\s*<\s*\/\s*pre\s*>/gi, "```");
  out = out.replace(/<\s*code\s*>/gi, "`");
  out = out.replace(/<\s*\/\s*code\s*>/gi, "`");
  out = out.replace(/<\s*(b|strong)\s*>/gi, "**");
  out = out.replace(/<\s*\/\s*(b|strong)\s*>/gi, "**");
  out = out.replace(/<\s*(i|em)\s*>/gi, "*");
  out = out.replace(/<\s*\/\s*(i|em)\s*>/gi, "*");
  return out;
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, "");
}

function stripMarkdown(text) {
  let out = String(text || "");
  out = out.replace(/```/g, "");
  out = out.replace(/`([^`]*)`/g, "$1");
  out = out.replace(/\*\*(.+?)\*\*/g, "$1");
  out = out.replace(/__(.+?)__/g, "$1");
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1$2");
  out = out.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1$2");
  out = out.replace(/^\s*#{1,6}\s+/gm, "");
  return out;
}

function parseMarkdownTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || !trimmed.includes("|")) return null;
  const raw = trimmed.split("|").map((cell) => cell.trim());
  if (raw.length > 0 && raw[0] === "") raw.shift();
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const cells = raw.map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableSeparator(cells) {
  if (!Array.isArray(cells) || cells.length < 2) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(String(cell || "").trim()));
}

function isNumberColumn(header, rows) {
  const label = String(header?.[0] || "").trim().toLowerCase();
  if (["#", "no", "no.", "number"].includes(label)) return true;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.every((row) => /^\d+[.)]?$/.test(String(row?.[0] || "").trim()));
}

function cleanTableCell(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatMarkdownTable(header, rows) {
  const numbered = isNumberColumn(header, rows);
  const primaryIndex = numbered ? 1 : 0;
  const output = [];

  rows.forEach((row, index) => {
    const number = cleanTableCell(row[0]) || String(index + 1);
    const primary = cleanTableCell(row[primaryIndex]) || cleanTableCell(row.find((cell) => cleanTableCell(cell)));
    const details = [];
    for (let i = 0; i < Math.max(header.length, row.length); i += 1) {
      if (numbered && i === 0) continue;
      if (i === primaryIndex) continue;
      const value = cleanTableCell(row[i]);
      if (!value) continue;
      const label = cleanTableCell(header[i]) || `Column ${i + 1}`;
      details.push(`${label}: ${value}`);
    }

    if (primary) {
      output.push(numbered ? `${number.replace(/[.)]$/, "")}. ${primary}` : `- ${primary}`);
    } else if (details.length > 0) {
      output.push(numbered ? `${number.replace(/[.)]$/, "")}. ${details.shift()}` : `- ${details.shift()}`);
    }
    if (details.length > 0) {
      output.push(`  ${details.join("; ")}`);
    }
  });

  return output.join("\n");
}

function convertMarkdownTables(text) {
  const lines = String(text || "").split("\n");
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const tableStart = i;
    const header = parseMarkdownTableRow(lines[i]);
    const separator = parseMarkdownTableRow(lines[i + 1]);
    if (!header || !separator || !isMarkdownTableSeparator(separator)) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    const rows = [];
    i += 2;
    while (i < lines.length) {
      const row = parseMarkdownTableRow(lines[i]);
      if (!row) break;
      rows.push(row);
      i += 1;
    }

    if (rows.length === 0) {
      output.push(...lines.slice(tableStart, i));
      continue;
    }
    output.push(formatMarkdownTable(header, rows));
  }

  return output.join("\n");
}

function transformNonCodeSegments(text, transform) {
  const segments = String(text || "").split("```");
  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : transform(segment)))
    .join("```");
}

function formatInline(text) {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  escaped = escaped.replace(/__(.+?)__/g, "<b>$1</b>");
  escaped = escaped.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<i>$2</i>");
  escaped = escaped.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1<i>$2</i>");
  return escaped;
}

function renderLine(line) {
  const headingMatch = line.match(/^\s*#{1,6}\s+(.+)/);
  if (headingMatch) {
    return `<b>${formatInline(headingMatch[1])}</b>`;
  }

  const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
  if (bulletMatch) {
    return `- ${formatInline(bulletMatch[1])}`;
  }

  return formatInline(line);
}

function renderInline(text) {
  const chunks = String(text || "").split("`");
  let output = "";
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (i % 2 === 1) {
      output += `<code>${escapeHtml(chunk)}</code>`;
      continue;
    }
    const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n").map((line) => renderLine(line));
    output += lines.join("\n");
  }
  return output;
}

export function renderTelegramHtml(text) {
  let normalized = normalizeAscii(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  normalized = normalized.replace(/\u2022/g, "-");
  normalized = decodeEntities(normalized);
  normalized = replaceHtmlFormatting(normalized);
  normalized = stripHtml(normalized);
  normalized = normalized.trim();

  const segments = normalized.split("```");
  let output = "";
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (i % 2 === 1) {
      output += `<pre><code>${escapeHtml(segment)}</code></pre>`;
      continue;
    }
    output += renderInline(convertMarkdownTables(segment));
  }
  return output.trim();
}

export function renderTelegramPlain(text) {
  let normalized = normalizeAscii(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  normalized = normalized.replace(/\u2022/g, "-");
  normalized = decodeEntities(normalized);
  normalized = replaceHtmlFormatting(normalized);
  normalized = stripHtml(normalized);
  normalized = transformNonCodeSegments(normalized, convertMarkdownTables);
  normalized = stripMarkdown(normalized);
  normalized = normalized.replace(/\s+\n/g, "\n");
  normalized = normalized.replace(/\n{3,}/g, "\n\n");
  return normalized.trim();
}
