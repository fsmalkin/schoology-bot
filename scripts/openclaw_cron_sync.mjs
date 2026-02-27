import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const gatewayUrl = String(process.env.OPENCLAW_GATEWAY_URL || "ws://openclaw-gateway:18789").trim();
let gatewayToken = String(process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
let gatewayTokenSource = gatewayToken ? "env" : "";
const stateDir = String(
  process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR || process.env.HOME || ""
).trim();
const configPath = path.join(stateDir || "/home/node/.openclaw", "openclaw.json");
const deviceIdentityPath = path.join(stateDir || "/home/node/.openclaw", "identity", "device.json");
const pairedDevicesPath = path.join(stateDir || "/home/node/.openclaw", "devices", "paired.json");
const cliTimeoutMs = Number(process.env.OPENCLAW_CRON_CLI_TIMEOUT_MS || 60000);
const timezone = String(process.env.TIMEZONE || "America/New_York").trim();
const scrapeCron = String(process.env.SCRAPE_CRON || "0 6 * * *").trim();
const sendCron = String(process.env.SEND_CRON || "0 7 * * *").trim();
const reminderCron = String(process.env.REMINDER_CRON || "*/1 * * * *").trim();
const targetRaw = String(
  process.env.OPENCLAW_CRON_TELEGRAM_TO || process.env.TELEGRAM_CHAT_IDS || ""
).trim();
const telegramTarget = targetRaw
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)[0];

const MANAGED_JOBS = [
  "Schoology Scrape Refresh",
  "Schoology Daily Summary",
  "Schoology Due Reminders",
];

if (!telegramTarget) {
  console.error(
    "[openclaw-cron-sync] TELEGRAM_CHAT_IDS (or OPENCLAW_CRON_TELEGRAM_TO) must include at least one target."
  );
  process.exit(1);
}

if (!gatewayToken) {
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const candidate = String(parsed?.gateway?.auth?.token || "").trim();
      if (candidate) {
        gatewayToken = candidate;
        gatewayTokenSource = "config";
      }
    }
  } catch (err) {
    // ignore parse errors and fail below with a clear message
  }
}

function loadPairedDeviceOperatorToken() {
  try {
    if (!fs.existsSync(pairedDevicesPath)) {
      return "";
    }
    const paired = JSON.parse(fs.readFileSync(pairedDevicesPath, "utf8"));
    if (!paired || typeof paired !== "object") {
      return "";
    }
    let preferredDeviceId = "";
    if (fs.existsSync(deviceIdentityPath)) {
      const identity = JSON.parse(fs.readFileSync(deviceIdentityPath, "utf8"));
      preferredDeviceId = String(identity?.deviceId || "").trim();
    }
    const entries = Object.values(paired);
    if (!Array.isArray(entries) || entries.length === 0) {
      return "";
    }
    const preferred =
      preferredDeviceId && paired[preferredDeviceId] ? paired[preferredDeviceId] : entries[0];
    return String(preferred?.tokens?.operator?.token || "").trim();
  } catch (err) {
    return "";
  }
}

function maybeSwitchToPairedDeviceToken(reasonText, force = false) {
  const lower = String(reasonText || "").toLowerCase();
  if (!force && !lower.includes("device token mismatch")) {
    return false;
  }
  const fallbackToken = loadPairedDeviceOperatorToken();
  if (!fallbackToken || fallbackToken === gatewayToken) {
    return false;
  }
  gatewayToken = fallbackToken;
  gatewayTokenSource = "paired-device";
  console.log(
    `[openclaw-cron-sync] switched gateway token source=${gatewayTokenSource} length=${gatewayToken.length}`
  );
  return true;
}

if (!gatewayToken) {
  const fallbackToken = loadPairedDeviceOperatorToken();
  if (fallbackToken) {
    gatewayToken = fallbackToken;
    gatewayTokenSource = "paired-device";
  }
}

if (!gatewayToken) {
  console.error(
    "[openclaw-cron-sync] missing gateway token. Set OPENCLAW_GATEWAY_TOKEN or configure gateway.auth.token in openclaw.json."
  );
  process.exit(1);
}
console.log(
  `[openclaw-cron-sync] gateway token source=${gatewayTokenSource || "unknown"} length=${gatewayToken.length}`
);

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

function parseJsonOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");
    let start = -1;
    if (firstBrace >= 0 && firstBracket >= 0) {
      start = Math.min(firstBrace, firstBracket);
    } else {
      start = Math.max(firstBrace, firstBracket);
    }
    if (start < 0) return null;
    const sliced = text.slice(start);
    try {
      return JSON.parse(sliced);
    } catch (innerErr) {
      return null;
    }
  }
}

function isRetryableGatewayError(detail, timedOut) {
  if (timedOut) {
    return true;
  }
  const lower = String(detail || "").toLowerCase();
  return (
    lower.includes("gateway closed (1006") ||
    lower.includes("abnormal closure") ||
    lower.includes("econnrefused") ||
    lower.includes("gateway not connected")
  );
}

function runCli(
  args,
  { expectJson = true, allowFailure = false, retries = 0, retryDelayMs = 3000 } = {}
) {
  const maxAttempts = Math.max(1, Number(retries || 0) + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const fullArgs = ["dist/index.js", ...args, "--url", gatewayUrl];
    if (gatewayToken) {
      fullArgs.push("--token", gatewayToken);
    }
    if (expectJson) {
      fullArgs.push("--json");
    }
    const result = spawnSync("node", fullArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: cliTimeoutMs,
      killSignal: "SIGKILL",
    });
    const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    const detail = stderr || stdout || (timedOut ? "command timed out" : "unknown error");

    if (timedOut) {
      if (allowFailure) {
        return { ...result, status: result.status ?? 124 };
      }
      maybeSwitchToPairedDeviceToken(detail);
      const canRetry = attempt < maxAttempts && isRetryableGatewayError(detail, true);
      if (canRetry) {
        console.log(
          `[openclaw-cron-sync] retrying command (${attempt}/${maxAttempts}) after timeout: node ${fullArgs.join(
            " "
          )}`
        );
        sleepMs(retryDelayMs);
        continue;
      }
      throw new Error(
        `[openclaw-cron-sync] command timed out after ${cliTimeoutMs}ms: node ${fullArgs.join(" ")}`
      );
    }

    if (result.status === 0 || allowFailure) {
      return result;
    }

    maybeSwitchToPairedDeviceToken(detail);
    const canRetry = attempt < maxAttempts && isRetryableGatewayError(detail, false);
    if (canRetry) {
      console.log(
        `[openclaw-cron-sync] retrying command (${attempt}/${maxAttempts}) after gateway error: ${detail}`
      );
      sleepMs(retryDelayMs);
      continue;
    }
    throw new Error(
      `[openclaw-cron-sync] command failed (${result.status}): node ${fullArgs.join(" ")}\n${detail}`
    );
  }
  throw new Error("[openclaw-cron-sync] command retry loop exhausted unexpectedly.");
}

function waitForGateway(maxAttempts = 40, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = runCli(["cron", "list", "--all"], { expectJson: true, allowFailure: true });
    if (res.status === 0) {
      console.log(`[openclaw-cron-sync] gateway healthy (attempt ${attempt}/${maxAttempts}).`);
      return;
    }
    const stderr = String(res.stderr || "").trim();
    const stdout = String(res.stdout || "").trim();
    const reason = stderr || stdout || "unknown error";
    console.log(
      `[openclaw-cron-sync] gateway not ready (attempt ${attempt}/${maxAttempts}): ${reason}`
    );
    if (!maybeSwitchToPairedDeviceToken(reason) && attempt >= 2) {
      maybeSwitchToPairedDeviceToken(reason, true);
    }
    if (attempt < maxAttempts) {
      sleepMs(delayMs);
    }
  }
  throw new Error("[openclaw-cron-sync] gateway did not become healthy in time.");
}

function listJobs() {
  const res = runCli(["cron", "list", "--all"], {
    expectJson: true,
    retries: 4,
    retryDelayMs: 4000,
  });
  const parsed = parseJsonOutput(res.stdout);
  const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  return jobs;
}

function removeJob(jobId) {
  runCli(["cron", "rm", String(jobId)], { expectJson: true, retries: 4, retryDelayMs: 4000 });
}

function addManagedJobs() {
  const base = ["cron", "add", "--session", "isolated", "--tz", timezone];

  runCli(
    base.concat([
      "--name",
      "Schoology Scrape Refresh",
      "--cron",
      scrapeCron,
      "--message",
      "Use schoology-tools. Call refresh_schoology once. If ok, reply exactly HEARTBEAT_OK. If not ok, reply with one short error line.",
      "--no-deliver",
    ]),
    { expectJson: true, retries: 4, retryDelayMs: 4000 }
  );

  runCli(
    base.concat([
      "--name",
      "Schoology Daily Summary",
      "--cron",
      sendCron,
      "--message",
      "Use schoology-tools. Call build_daily_summary once. Reply with output.summaryText only and no extra text.",
      "--announce",
      "--channel",
      "telegram",
      "--to",
      telegramTarget,
      "--best-effort-deliver",
    ]),
    { expectJson: true, retries: 4, retryDelayMs: 4000 }
  );

  runCli(
    base.concat([
      "--name",
      "Schoology Due Reminders",
      "--cron",
      reminderCron,
      "--message",
      "Use schoology-tools. Call drain_due_reminders once. If output.count is 0, reply exactly HEARTBEAT_OK. If output.count is greater than 0, reply with output.messages joined by a blank line and no extra text.",
      "--announce",
      "--channel",
      "telegram",
      "--to",
      telegramTarget,
      "--best-effort-deliver",
    ]),
    { expectJson: true, retries: 4, retryDelayMs: 4000 }
  );
}

function syncManagedCronJobs() {
  const jobs = listJobs();
  const toRemove = jobs.filter((job) => MANAGED_JOBS.includes(String(job?.name || "")));
  for (const job of toRemove) {
    removeJob(job.id);
  }
  addManagedJobs();
  const finalJobs = listJobs().filter((job) => MANAGED_JOBS.includes(String(job?.name || "")));
  console.log(`[openclaw-cron-sync] managed jobs ready: ${finalJobs.length}`);
  for (const job of finalJobs) {
    const schedule = job?.schedule?.kind === "cron" ? job?.schedule?.expr : job?.schedule?.kind;
    console.log(`[openclaw-cron-sync] - ${job.name} (${schedule || "unknown"})`);
  }
}

console.log("[openclaw-cron-sync] starting");
console.log(`[openclaw-cron-sync] gateway=${gatewayUrl} timezone=${timezone} cliTimeoutMs=${cliTimeoutMs}`);
waitForGateway();
syncManagedCronJobs();
console.log("[openclaw-cron-sync] done");
