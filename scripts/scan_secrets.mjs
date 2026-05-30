import { execFileSync } from "node:child_process";
import fs from "node:fs";

const patterns = [
  {
    name: "OpenAI API key",
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "Anthropic API key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "GitHub token",
    re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: "Telegram bot token",
    re: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    name: "Private key block",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function mask(value) {
  const text = String(value || "");
  if (text.length <= 10) return "[masked]";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

let findings = 0;

for (const file of trackedFiles()) {
  let content;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    for (const match of content.matchAll(pattern.re)) {
      findings += 1;
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      console.error(`${file}:${line}: ${pattern.name}: ${mask(match[0])}`);
    }
  }
}

if (findings > 0) {
  console.error(`Secret scan failed with ${findings} finding(s).`);
  process.exit(1);
}

console.log("Secret scan passed.");
