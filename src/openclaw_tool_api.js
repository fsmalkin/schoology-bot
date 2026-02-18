import "dotenv/config";
import http from "http";
import { getConfig } from "./config.js";
import { ensureDbSeeded, getDb } from "./db.js";
import { writeServiceHeartbeat } from "./health.js";
import { runToolByName, TOOL_NAMES } from "./tool_runner.js";

const config = getConfig();
const db = getDb(config);
ensureDbSeeded(db, config.paths.statePath);

const port = Number(process.env.SCHOOLOGY_TOOL_API_PORT || process.env.TOOL_API_PORT || 3030);
const apiKey = String(process.env.SCHOOLOGY_TOOL_API_KEY || process.env.TOOL_API_KEY || "").trim();
const runtime = {
  startedAt: new Date().toISOString(),
  requests: 0,
  errors: 0,
  lastRequestAt: null,
  lastTool: null,
  lastErrorAt: null,
  lastError: null,
};

function updateHeartbeat(extra = {}) {
  try {
    writeServiceHeartbeat(config, "schoology-tool-api", {
      status: "running",
      port,
      tools: TOOL_NAMES.length,
      ...runtime,
      ...extra,
    });
  } catch (err) {
    // heartbeat failures should not stop the API
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    runtime.requests += 1;
    runtime.lastRequestAt = new Date().toISOString();
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      updateHeartbeat();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method !== "POST" || url.pathname !== "/tools/run") {
      updateHeartbeat();
      return sendJson(res, 404, { ok: false, error: "Not found." });
    }
    if (apiKey) {
      const auth = String(req.headers.authorization || "");
      if (auth !== `Bearer ${apiKey}`) {
        updateHeartbeat();
        return sendJson(res, 401, { ok: false, error: "Unauthorized." });
      }
    }
    const body = await readJson(req);
    const tool = String(body?.tool || "").trim();
    const args = body?.args && typeof body.args === "object" ? body.args : {};
    if (!tool || !TOOL_NAMES.includes(tool)) {
      runtime.lastTool = tool || null;
      updateHeartbeat();
      return sendJson(res, 400, { ok: false, error: "Unknown tool.", tool });
    }
    runtime.lastTool = tool;
    const output = await runToolByName(db, tool, args);
    runtime.lastError = null;
    runtime.lastErrorAt = null;
    updateHeartbeat();
    return sendJson(res, 200, { ok: true, tool, output });
  } catch (err) {
    runtime.errors += 1;
    runtime.lastErrorAt = new Date().toISOString();
    runtime.lastError = err?.message || String(err);
    updateHeartbeat();
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
});

server.listen(port, () => {
  console.log(`[openclaw-api] listening on ${port}`);
  updateHeartbeat();
  setInterval(() => updateHeartbeat(), 30000);
});
