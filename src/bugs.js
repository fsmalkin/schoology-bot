import fs from "fs";
import path from "path";
import { nowIso } from "./time.js";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => String(label || "").trim()).filter((label) => label.length > 0);
}

export function logBugToFile(config, { title, body, labels, kind = "bug" }) {
  const logPath = config?.paths?.bugLogPath || path.join(process.cwd(), "data", "bugs.log");
  ensureDir(path.dirname(logPath));
  const entry = {
    createdAt: nowIso(),
    kind,
    title: String(title || "").trim(),
    body: String(body || "").trim(),
    labels: sanitizeLabels(labels),
  };
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return { ok: true, logPath };
}

export async function createGithubIssue(config, { title, body, labels, kind = "bug" }) {
  const repo = config?.github?.repo;
  const token = config?.github?.token;
  if (!repo || !token) {
    return { ok: false, error: "Missing GITHUB_REPO or GITHUB_TOKEN." };
  }

  const payload = {
    title: String(title || "").trim(),
    body: String(body || "").trim(),
  };
  const labelList = sanitizeLabels((labels && labels.length ? labels : config.github.labels) || []);
  if (labelList.length === 0 && kind) {
    labelList.push(kind);
  }
  if (labelList.length > 0) {
    payload.labels = labelList;
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, error: `GitHub issue create failed (${response.status}): ${errorText}` };
  }

  const data = await response.json();
  return { ok: true, url: data.html_url, number: data.number };
}

export async function openBugReport(config, { title, body, labels }) {
  const logResult = logBugToFile(config, { title, body, labels, kind: "bug" });
  const issueResult = await createGithubIssue(config, { title, body, labels, kind: "bug" });
  return { logged: logResult.ok, logPath: logResult.logPath, issue: issueResult };
}

export async function openFeatureRequest(config, { title, body, labels }) {
  const logResult = logBugToFile(config, { title, body, labels, kind: "feature" });
  const issueResult = await createGithubIssue(config, { title, body, labels, kind: "feature" });
  return { logged: logResult.ok, logPath: logResult.logPath, issue: issueResult };
}
