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
    output += renderInline(segment);
  }
  return output.trim();
}

export function renderTelegramPlain(text) {
  let normalized = normalizeAscii(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  normalized = normalized.replace(/\u2022/g, "-");
  normalized = decodeEntities(normalized);
  normalized = replaceHtmlFormatting(normalized);
  normalized = stripHtml(normalized);
  normalized = stripMarkdown(normalized);
  normalized = normalized.replace(/\s+\n/g, "\n");
  normalized = normalized.replace(/\n{3,}/g, "\n\n");
  return normalized.trim();
}
