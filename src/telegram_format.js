export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    return `&bull; ${formatInline(bulletMatch[1])}`;
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
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
