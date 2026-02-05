import fs from "fs";
import path from "path";

const MAX_DEFAULT = Number(process.env.BOOTSTRAP_MAX_CHARS || 4000);
let cached = null;

function readFileIfExists(filePath, maxChars) {
  if (!fs.existsSync(filePath)) return "";
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[truncated]`;
}

function readSkills(dirPath, maxCharsPerFile) {
  if (!fs.existsSync(dirPath)) return "";
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const mdFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  if (mdFiles.length === 0) return "";

  const blocks = [];
  for (const name of mdFiles) {
    const filePath = path.join(dirPath, name);
    const content = readFileIfExists(filePath, maxCharsPerFile);
    if (!content) continue;
    blocks.push(`Skill: ${name}\n${content}`);
  }
  return blocks.join("\n\n");
}

export function getBootstrapContext({ maxChars = MAX_DEFAULT } = {}) {
  if (cached && cached.maxChars === maxChars) return cached.value;

  const root = process.cwd();
  const sections = [];
  const agents = readFileIfExists(path.join(root, "AGENTS.md"), maxChars);
  if (agents) sections.push(`AGENTS.md\n${agents}`);

  const tools = readFileIfExists(path.join(root, "TOOLS.md"), maxChars);
  if (tools) sections.push(`TOOLS.md\n${tools}`);

  const soul = readFileIfExists(path.join(root, "SOUL.md"), maxChars);
  if (soul) sections.push(`SOUL.md\n${soul}`);

  const skills = readSkills(path.join(root, "skills"), Math.max(500, Math.floor(maxChars / 2)));
  if (skills) sections.push(`Skills\n${skills}`);

  const value = sections.join("\n\n");
  cached = { maxChars, value };
  return value;
}
