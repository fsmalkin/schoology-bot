import fs from "fs";
import path from "path";

const DEFAULT_STALE_MS = 120000;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeServiceName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}

function parseTimestamp(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

export function getHealthDir(config) {
  const dataDir = config?.paths?.dataDir || path.join(process.cwd(), "data");
  return path.join(dataDir, "health");
}

export function getHeartbeatPath(config, service) {
  const name = safeServiceName(service) || "service";
  return path.join(getHealthDir(config), `${name}.heartbeat.json`);
}

export function writeServiceHeartbeat(config, service, details = {}) {
  const filePath = getHeartbeatPath(config, service);
  ensureDir(path.dirname(filePath));
  const payload = {
    service: safeServiceName(service),
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ...details,
  };
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
  return payload;
}

export function readServiceHeartbeat(config, service) {
  const filePath = getHeartbeatPath(config, service);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

export function summarizeHeartbeat(heartbeat, now = new Date(), staleMs = DEFAULT_STALE_MS) {
  if (!heartbeat) {
    return {
      ok: false,
      state: "down",
      ageMs: null,
      timestamp: null,
      staleMs,
    };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  const stampMs = parseTimestamp(heartbeat.timestamp);
  if (!Number.isFinite(nowMs) || stampMs === null) {
    return {
      ok: false,
      state: "unknown",
      ageMs: null,
      timestamp: heartbeat.timestamp || null,
      staleMs,
    };
  }
  const ageMs = Math.max(0, nowMs - stampMs);
  const ok = ageMs <= staleMs;
  return {
    ok,
    state: ok ? "ok" : "stale",
    ageMs,
    timestamp: heartbeat.timestamp || null,
    staleMs,
  };
}

export function formatDurationMinutes(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  if (ms < 60000) return "<1 min";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} hr`;
  return `${hours} hr ${rem} min`;
}
