import fs from "fs";
import http from "http";
import { buildDashboardSnapshot } from "./dashboard_data.js";
import {
  buildAssignmentDetail,
  buildAssignmentsWorkspace,
  buildDashboardMeta,
  buildHomeWorkspace,
  buildTasksWorkspace,
  DASHBOARD_ALLOWED_TOOL_NAMES,
} from "./dashboard_workbench_data.js";
import { ensureDbSeeded, getDb } from "./db.js";
import { writeServiceHeartbeat } from "./health.js";
import { runToolByName } from "./tool_runner.js";

const DASHBOARD_HTML = fs.readFileSync(new URL("./dashboard_assets/index.html", import.meta.url), "utf8");
const DASHBOARD_CSS = fs.readFileSync(new URL("./dashboard_assets/dashboard.css", import.meta.url), "utf8");
const DASHBOARD_JS = fs.readFileSync(new URL("./dashboard_assets/dashboard.js", import.meta.url), "utf8");

function statusClass(state) {
  if (state === "ok") return "ok";
  if (state === "stale") return "stale";
  return "down";
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, content, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(content);
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

function getSameOriginBases(req) {
  const host = String(req.headers.host || "").trim().toLowerCase();
  if (!host) return [];
  return [`http://${host}`, `https://${host}`];
}

function matchesSameOriginHeader(headerValue, req) {
  const value = String(headerValue || "").trim().toLowerCase();
  if (!value) return false;
  return getSameOriginBases(req).some((base) => value === base || value.startsWith(`${base}/`));
}

function isTrustedWriteRequest(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const requestHeader = String(req.headers["x-schoology-dashboard-request"] || "").trim();
  if (!contentType.includes("application/json")) return false;
  if (requestHeader !== "1") return false;
  if (matchesSameOriginHeader(req.headers.origin, req)) return true;
  return matchesSameOriginHeader(req.headers.referer, req);
}

function dashboardDb(config) {
  const db = getDb(config);
  ensureDbSeeded(db, config.paths.statePath);
  return db;
}

function queryObject(searchParams) {
  const entries = {};
  for (const [key, value] of searchParams.entries()) {
    entries[key] = value;
  }
  return entries;
}

export function renderDashboardPage() {
  return DASHBOARD_HTML;
}

export function createDashboardServer({
  config,
  logger = console,
  htmlOverride = "",
  assetsOverride = {},
  toolExecutor = runToolByName,
}) {
  const assets = {
    html: htmlOverride || DASHBOARD_HTML,
    css: assetsOverride.css || DASHBOARD_CSS,
    js: assetsOverride.js || DASHBOARD_JS,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const assignmentDetailMatch = url.pathname.match(/^\/api\/assignments\/([^/]+)\/detail$/);

      if (req.method === "GET" && url.pathname === "/") {
        return sendText(res, 200, assets.html, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/assets/dashboard.css") {
        return sendText(res, 200, assets.css, "text/css; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/assets/dashboard.js") {
        return sendText(res, 200, assets.js, "text/javascript; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, buildDashboardSnapshot({ config, now: new Date() }));
      }
      if (req.method === "GET" && url.pathname === "/api/meta") {
        return sendJson(res, 200, buildDashboardMeta({ config }));
      }
      if (req.method === "GET" && url.pathname === "/api/home") {
        return sendJson(res, 200, buildHomeWorkspace({ config }));
      }
      if (req.method === "GET" && url.pathname === "/api/assignments") {
        return sendJson(
          res,
          200,
          buildAssignmentsWorkspace({ config, query: queryObject(url.searchParams) })
        );
      }
      if (req.method === "GET" && assignmentDetailMatch) {
        const key = decodeURIComponent(assignmentDetailMatch[1]);
        const detail = buildAssignmentDetail({ config, key });
        if (!detail) {
          return sendJson(res, 404, { ok: false, error: "Assignment not found." });
        }
        return sendJson(res, 200, detail);
      }
      if (req.method === "GET" && url.pathname === "/api/tasks") {
        return sendJson(res, 200, buildTasksWorkspace({ config, query: queryObject(url.searchParams) }));
      }
      if (req.method === "POST" && url.pathname === "/api/tools/run") {
        if (!isTrustedWriteRequest(req)) {
          return sendJson(res, 403, { ok: false, error: "Dashboard write request rejected." });
        }
        const body = await readJson(req);
        const tool = String(body?.tool || "").trim();
        const args = body?.args && typeof body.args === "object" ? body.args : {};
        if (!tool || !DASHBOARD_ALLOWED_TOOL_NAMES.includes(tool)) {
          return sendJson(res, 400, { ok: false, error: "Unsupported dashboard tool.", tool });
        }
        const output = await toolExecutor(dashboardDb(config), tool, args, {});
        return sendJson(res, 200, { ok: true, tool, output });
      }
      return sendJson(res, 404, { ok: false, error: "Not found." });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
    }
  });

  function writeHeartbeat(extra = {}) {
    try {
      writeServiceHeartbeat(config, "dashboard", {
        status: "running",
        ...extra,
      });
    } catch {
      // ignore heartbeat errors
    }
  }

  let interval = null;
  return {
    server,
    start(port, host = "127.0.0.1") {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          writeHeartbeat({ port });
          interval = setInterval(() => writeHeartbeat({ port }), 30000);
          logger.log(`[dashboard] listening on http://${host}:${port}`);
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (interval) clearInterval(interval);
        interval = null;
        writeHeartbeat({ status: "stopping" });
        server.close(() => resolve());
      });
    },
  };
}

export function mapServiceStatusForUi(snapshot) {
  const services = Array.isArray(snapshot?.services) ? snapshot.services : [];
  return services.map((service) => ({
    ...service,
    uiClass: statusClass(service.state),
  }));
}
