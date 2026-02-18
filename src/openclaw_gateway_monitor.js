import net from "net";
import { getConfig } from "./config.js";
import { writeServiceHeartbeat } from "./health.js";

const config = getConfig();
const host = String(process.env.OPENCLAW_GATEWAY_HOST || "openclaw-gateway").trim();
const port = Number(process.env.OPENCLAW_GATEWAY_PORT || 18789);
const timeoutMs = Number(process.env.OPENCLAW_GATEWAY_MONITOR_TIMEOUT_MS || 1500);
const intervalMs = Number(process.env.OPENCLAW_GATEWAY_MONITOR_INTERVAL_MS || 30000);
const runtime = {
  startedAt: new Date().toISOString(),
  lastCheckAt: null,
  lastOkAt: null,
  lastErrorAt: null,
  lastError: null,
  checks: 0,
};

function updateHeartbeat(status, extra = {}) {
  try {
    writeServiceHeartbeat(config, "openclaw-gateway", {
      status,
      host,
      port,
      timeoutMs,
      intervalMs,
      ...runtime,
      ...extra,
    });
  } catch (err) {
    // heartbeat failures should not stop the monitor
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeTcp() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (err) {
        // ignore
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, error: "timeout" }));
    socket.once("error", (err) => finish({ ok: false, error: err?.message || String(err) }));

    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ ok: false, error: err?.message || String(err) });
    }
  });
}

async function runLoop() {
  while (true) {
    runtime.checks += 1;
    runtime.lastCheckAt = new Date().toISOString();
    const result = await probeTcp();
    if (result.ok) {
      runtime.lastOkAt = new Date().toISOString();
      runtime.lastError = null;
      runtime.lastErrorAt = null;
      updateHeartbeat("running");
    } else {
      runtime.lastErrorAt = new Date().toISOString();
      runtime.lastError = result.error || "unknown";
      updateHeartbeat("error", { probeError: runtime.lastError });
    }
    await sleep(intervalMs);
  }
}

console.log(`[openclaw-gateway-monitor] probing ${host}:${port} every ${intervalMs}ms`);
updateHeartbeat("starting");
runLoop().catch((err) => {
  runtime.lastErrorAt = new Date().toISOString();
  runtime.lastError = err?.message || String(err);
  updateHeartbeat("error", { fatal: true });
  console.error("[openclaw-gateway-monitor] fatal:", runtime.lastError);
  process.exit(1);
});
