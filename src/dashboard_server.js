import http from "http";
import { buildDashboardSnapshot } from "./dashboard_data.js";
import { writeServiceHeartbeat } from "./health.js";

function statusClass(state) {
  if (state === "ok") return "ok";
  if (state === "stale") return "stale";
  return "down";
}

export function renderDashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Schoology Health Dashboard</title>
  <style>
    :root {
      --bg-top: #f7f3ea;
      --bg-mid: #fdfcf7;
      --panel: #fffef9;
      --line: #d8d4c8;
      --ink: #202123;
      --muted: #5a5f66;
      --ok: #1f7a45;
      --warn: #b9681b;
      --bad: #a7372f;
      --accent: #175f8c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif;
      background:
        radial-gradient(1200px 500px at 20% -10%, #fff9e8 0%, transparent 60%),
        radial-gradient(900px 500px at 100% -10%, #e8f3ff 0%, transparent 60%),
        linear-gradient(180deg, var(--bg-top), var(--bg-mid));
      min-height: 100vh;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: 22px 16px 32px;
    }
    .hero {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px;
      display: grid;
      gap: 8px;
      box-shadow: 0 8px 22px rgba(0,0,0,0.05);
    }
    .title {
      margin: 0;
      font-size: clamp(1.3rem, 2.7vw, 2rem);
      letter-spacing: 0.2px;
    }
    .subtitle {
      color: var(--muted);
      font-size: 0.96rem;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    button {
      border: 1px solid #a9bfd0;
      background: #e8f2fa;
      color: #163f59;
      border-radius: 999px;
      padding: 7px 12px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { filter: brightness(0.98); }
    .grid {
      display: grid;
      gap: 14px;
      margin-top: 14px;
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 6px 16px rgba(0,0,0,0.04);
      min-width: 0;
    }
    .services { grid-column: span 12; }
    .stats { grid-column: span 12; }
    .flow { grid-column: span 12; }
    .commands { grid-column: span 12; }
    .docs { grid-column: span 12; }
    @media (min-width: 900px) {
      .stats { grid-column: span 7; }
      .flow { grid-column: span 5; }
      .commands { grid-column: span 7; }
      .docs { grid-column: span 5; }
    }
    h2 {
      margin: 0 0 10px;
      font-size: 1.02rem;
      color: var(--accent);
      letter-spacing: 0.25px;
    }
    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .service-card {
      flex: 1 1 220px;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: #fff;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 9px;
      font-size: 0.78rem;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .pill.ok { color: var(--ok); background: #e8f6ed; border-color: #c7ebd2; }
    .pill.stale { color: var(--warn); background: #fff1e1; border-color: #f8d6b0; }
    .pill.down { color: var(--bad); background: #fbe9e8; border-color: #f2c7c4; }
    .meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 0.86rem;
      line-height: 1.35;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
      gap: 8px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 10px;
    }
    .metric .k {
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .metric .v {
      margin-top: 6px;
      font-size: 1.3rem;
      font-weight: 700;
    }
    ul {
      margin: 0;
      padding-left: 18px;
      line-height: 1.42;
    }
    .mono {
      font-family: "Consolas", "SFMono-Regular", "Menlo", monospace;
      font-size: 0.84rem;
      background: #f5f6f8;
      border: 1px solid #dde1e5;
      border-radius: 8px;
      padding: 7px 9px;
      margin: 6px 0;
      overflow-wrap: anywhere;
    }
    .tiny {
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1 class="title">Schoology Health Dashboard</h1>
      <div class="subtitle" id="subtitle">Loading status...</div>
      <div class="toolbar">
        <button id="refreshBtn" type="button">Refresh now</button>
        <button id="copyBtn" type="button">Copy local URL</button>
      </div>
    </section>

    <section class="grid">
      <article class="panel services">
        <h2>Services</h2>
        <div class="row" id="services"></div>
      </article>

      <article class="panel stats">
        <h2>Today At A Glance</h2>
        <div class="metrics" id="metrics"></div>
        <div class="meta" id="activity"></div>
      </article>

      <article class="panel flow">
        <h2>How It Works</h2>
        <ul id="how"></ul>
      </article>

      <article class="panel commands">
        <h2>Quick Commands</h2>
        <div id="commands"></div>
      </article>

      <article class="panel docs">
        <h2>Docs</h2>
        <ul id="docs"></ul>
        <div class="tiny">Paths are local repo paths for quick reference.</div>
      </article>
    </section>
  </div>

  <script>
    function esc(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function statusClass(state) {
      if (state === "ok") return "ok";
      if (state === "stale") return "stale";
      return "down";
    }

    function render(snapshot) {
      const subtitle = document.getElementById("subtitle");
      subtitle.textContent = "Updated " + new Date(snapshot.generatedAt).toLocaleString() + " (" + snapshot.timezone + ")";

      const services = document.getElementById("services");
      services.innerHTML = (snapshot.services || []).map((svc) => {
        return '<div class="service-card">'
          + '<div><strong>' + esc(svc.label) + '</strong> '
          + '<span class="pill ' + statusClass(svc.state) + '">' + esc(svc.state.toUpperCase()) + '</span></div>'
          + '<div class="meta">Last seen: ' + esc(svc.lastSeenLabel) + '<br/>Age: ' + esc(svc.ageLabel) + '</div>'
          + '</div>';
      }).join("");

      const m = [];
      m.push({ k: "Actionable", v: snapshot.assignments.actionable });
      m.push({ k: "Waiting", v: snapshot.assignments.waiting });
      m.push({ k: "Ignored", v: snapshot.assignments.ignored });
      m.push({ k: "Missing Total", v: snapshot.assignments.totalMissing });
      m.push({ k: "Tasks Pending", v: snapshot.tasks.pending });
      m.push({ k: "Tasks Overdue", v: snapshot.tasks.overdue });
      m.push({ k: "Tasks Today", v: snapshot.tasks.today });
      m.push({ k: "Tasks Upcoming", v: snapshot.tasks.upcoming });
      document.getElementById("metrics").innerHTML = m.map((item) => {
        return '<div class="metric"><div class="k">' + esc(item.k) + '</div><div class="v">' + esc(item.v) + '</div></div>';
      }).join("");

      document.getElementById("activity").innerHTML =
        "Last scrape: <strong>" + esc(snapshot.activity.lastScrapeLabel) + "</strong> (" + esc(snapshot.activity.lastScrapeAgeLabel) + ")"
        + "<br/>Last summary: <strong>" + esc(snapshot.activity.lastSummaryLabel) + "</strong> (" + esc(snapshot.activity.lastSummaryAgeLabel) + ")";

      document.getElementById("how").innerHTML = (snapshot.howItWorks || []).map((line) => {
        return "<li>" + esc(line) + "</li>";
      }).join("");

      document.getElementById("commands").innerHTML = (snapshot.quickCommands || []).map((cmd) => {
        return '<div class="mono">' + esc(cmd) + '</div>';
      }).join("");

      const docs = Object.entries(snapshot.docs || {});
      document.getElementById("docs").innerHTML = docs.map((entry) => {
        return "<li><span class='mono'>" + esc(entry[1]) + "</span></li>";
      }).join("");
    }

    async function refresh() {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load dashboard data.");
      const payload = await response.json();
      render(payload);
    }

    document.getElementById("refreshBtn").addEventListener("click", () => {
      refresh().catch((err) => {
        document.getElementById("subtitle").textContent = err.message;
      });
    });

    document.getElementById("copyBtn").addEventListener("click", async () => {
      const url = window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        document.getElementById("subtitle").textContent = "URL copied: " + url;
      } catch (err) {
        document.getElementById("subtitle").textContent = "Copy failed. Bookmark this URL manually: " + url;
      }
    });

    refresh().catch((err) => {
      document.getElementById("subtitle").textContent = err.message;
    });
    setInterval(() => refresh().catch(() => {}), 30000);
  </script>
</body>
</html>`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

export function createDashboardServer({ config, logger = console, htmlOverride = "" }) {
  const page = htmlOverride || renderDashboardPage();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/") {
      return sendHtml(res, page);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      try {
        const snapshot = buildDashboardSnapshot({ config, now: new Date() });
        return sendJson(res, 200, snapshot);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
      }
    }
    return sendJson(res, 404, { ok: false, error: "Not found." });
  });

  function writeHeartbeat(extra = {}) {
    try {
      writeServiceHeartbeat(config, "dashboard", {
        status: "running",
        ...extra,
      });
    } catch (err) {
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
