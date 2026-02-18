import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const gatewayUrl = String(process.env.OPENCLAW_GATEWAY_URL || "ws://openclaw-gateway:18789").trim();
let gatewayToken = String(process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
let gatewayTokenSource = gatewayToken ? "env" : "";
const cliTimeoutMs = Number(process.env.OPENCLAW_CRON_CLI_TIMEOUT_MS || 15000);
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
    const cfgPath = path.join("/home/node/.openclaw", "openclaw.json");
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
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

if (!gatewayToken) {
  console.error(
    "[openclaw-cron-sync] missing gateway token. Set OPENCLAW_GATEWAY_TOKEN or configure gateway.auth.token in /home/node/.openclaw/openclaw.json."
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

function runCli(args, { expectJson = true, allowFailure = false } = {}) {
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
  if (result.error && result.error.code === "ETIMEDOUT") {
    if (!allowFailure) {
      throw new Error(
        `[openclaw-cron-sync] command timed out after ${cliTimeoutMs}ms: node ${fullArgs.join(" ")}`
      );
    }
    return { ...result, status: result.status ?? 124 };
  }
  if (result.status !== 0 && !allowFailure) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(
      `[openclaw-cron-sync] command failed (${result.status}): node ${fullArgs.join(" ")}\n${stderr || stdout}`
    );
  }
  return result;
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
    console.log(
      `[openclaw-cron-sync] gateway not ready (attempt ${attempt}/${maxAttempts}): ${stderr || stdout || "unknown error"}`
    );
    if (attempt < maxAttempts) {
      sleepMs(delayMs);
    }
  }
  throw new Error("[openclaw-cron-sync] gateway did not become healthy in time.");
}

function listJobs() {
  const res = runCli(["cron", "list", "--all"], { expectJson: true });
  const parsed = parseJsonOutput(res.stdout);
  const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  return jobs;
}

function removeJob(jobId) {
  runCli(["cron", "rm", String(jobId)], { expectJson: true });
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
    { expectJson: true }
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
    { expectJson: true }
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
    { expectJson: true }
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
