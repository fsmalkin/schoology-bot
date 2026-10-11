import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Evaluate the real entrypoint without importing credentials, SQLite or an SDK.
const [scenario, directory] = process.argv.slice(2);
const root = path.resolve(directory);
const lockPath = path.join(root, "telegram_agent.lock");
const guardPath = `${lockPath}.acquire`;
const reportPath = path.join(root, "report.json");
const markerPath = path.join(root, "synthetic-saved-state.bin");
const marker = Buffer.from("SYNTHETIC EXISTING STATE: preserve this byte for byte");
const kernelCase = scenario.startsWith("kernel-");
const fixturePlatform = kernelCase ? process.platform : scenario.startsWith("linux-") ? "linux" : "win32";
const samePid = scenario.endsWith("self-pid") || ["linux-same-pid-live-owner", "linux-legacy-lock", "foreign-platform"].includes(scenario);
let priorLock = scenario === "malformed-lock"
  ? "not-json"
  : JSON.stringify({
    pid: scenario === "invalid-pid" ? -1 : samePid ? process.pid : 424242,
    startedAt: "fixture",
    platform: scenario === "linux-legacy-lock" ? undefined : scenario.includes("foreign-platform") ? (fixturePlatform === "linux" ? "win32" : "linux") : fixturePlatform,
    kernelLease: fixturePlatform === "linux" ? "linux-flock-v1" : undefined,
  });
const existingCases = new Set([
  "live-owner", "stale-owner", "unknown-pid", "malformed-lock", "invalid-pid",
  "read-denied", "linux-unrelated", "linux-unreadable",
  "self-pid", "linux-self-pid", "linux-live-owner",
  "linux-same-pid-live-owner", "linux-lease-missing", "linux-lease-uncertain",
  "linux-legacy-lock", "linux-lease-changed", "foreign-platform", "linux-foreign-platform",
]);
fs.writeFileSync(markerPath, marker);
if (existingCases.has(scenario)) fs.writeFileSync(lockPath, priorLock);
if (kernelCase && fs.existsSync(lockPath)) priorLock = fs.readFileSync(lockPath, "utf8");
if (scenario === "startup-claimed") fs.writeFileSync(guardPath, "another startup claim");
const events = [];
const handlers = new Map();
const timeouts = new Map();
let nextTimer = 0;
let bot;
const leaseDescriptors = new Set();
let leaseHeld = false;

function record(type, details = {}) {
  events.push({ type, ...details });
}
function codedError(code) {
  return Object.assign(new Error(`fixture ${code}`), { code });
}
function fixturePath(value) {
  const resolved = path.resolve(String(value));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Entry point attempted filesystem access outside the synthetic fixture");
  }
  return resolved;
}
function flush() {
  const report = {
    events,
    priorLock,
    lock: fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8") : null,
    guard: fs.existsSync(guardPath) ? fs.readFileSync(guardPath, "utf8") : null,
    markerUnchanged: fs.readFileSync(markerPath).equals(marker),
    markerSha256: createHash("sha256").update(fs.readFileSync(markerPath)).digest("hex"),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report));
  if (kernelCase) {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const hostPid = Number(status.match(/^NSpid:\s+(\d+)/m)?.[1]);
    report.namespacePid = process.pid;
    report.hostPid = hostPid;
    report.startTicks = fs.readFileSync(`/proc/${hostPid}/stat`, "utf8").split(") ")[1].split(" ")[19];
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
}

const fakeFs = {
  existsSync(value) {
    if (String(value).startsWith("/proc/")) return true;
    return fs.existsSync(fixturePath(value));
  },
  readFileSync(value, encoding) {
    if (String(value).startsWith("/proc/")) {
      if (scenario === "linux-unreadable") throw codedError("EACCES");
      if (scenario === "linux-self-pid" || scenario === "linux-live-owner") {
        return "node\u0000src/telegram_agent.js\u0000";
      }
      return "node\u0000unrelated-service.js\u0000";
    }
    const file = fixturePath(value);
    if (scenario === "read-denied" && file === lockPath) throw codedError("EACCES");
    return fs.readFileSync(file, encoding);
  },
  mkdirSync(value, options) { return fs.mkdirSync(fixturePath(value), options); },
  openSync(value, flags) {
    const fd = fs.openSync(fixturePath(value), flags);
    leaseDescriptors.add(fd);
    return fd;
  },
  closeSync(fd) {
    if (!leaseDescriptors.delete(fd)) throw new Error("Unowned fixture descriptor");
    fs.closeSync(fd);
    leaseHeld = false;
    record("lease-release");
  },
  fstatSync(fd, options) {
    if (!leaseDescriptors.has(fd)) throw new Error("Unowned fixture descriptor");
    return fs.fstatSync(fd, options);
  },
  statSync(value, options) {
    const stat = fs.statSync(fixturePath(value), options);
    return scenario === "linux-lease-changed" ? { dev: stat.dev, ino: stat.ino + 1n } : stat;
  },
  writeFileSync(value, data, options) {
    const file = fixturePath(value);
    if (file === lockPath && scenario === "write-denied") throw codedError("EACCES");
    if (file === lockPath && scenario === "concurrent-claim") {
      fs.writeFileSync(lockPath, "concurrent owner");
      throw codedError("EEXIST");
    }
    fs.writeFileSync(file, data, options);
    record(file === lockPath ? "lock-write" : "claim-write", {
      exclusive: typeof options === "object" && options.flag === "wx",
    });
  },
  unlinkSync(value) {
    const file = fixturePath(value);
    fs.unlinkSync(file);
    record(file === lockPath ? "lock-remove" : "claim-remove");
  },
  appendFileSync(value, data, encoding) {
    fs.appendFileSync(fixturePath(value), data, encoding);
    record("log-write");
  },
};

class FakeTelegramBot extends EventEmitter {
  constructor(_token, options) {
    super();
    record("poller-construction", {
      polling: options.polling,
      lockAlreadyPresent: fs.existsSync(lockPath),
      claimReleased: !fs.existsSync(guardPath),
      leaseHeld,
    });
    if (scenario === "constructor-failure") throw new Error("fixture client construction failed");
    bot = this;
  }
  async sendChatAction(chatId, action, options) { record("typing", { chatId, action, options }); }
  async sendMessage(chatId, text, options) {
    record("send", { chatId, text, options });
    return { message_id: 901 };
  }
  async editMessageText() { throw new Error("Unexpected edit in fixture"); }
  async deleteMessage() { record("delete-message"); }
  async stopPolling() { record("stop-polling"); }
  async startPolling() { record("restart-polling"); }
}

const config = {
  telegram: { botToken: "synthetic-placeholder", chatIds: ["7001"], messageThreadId: "33" },
  paths: { dataDir: root },
  managedAgents: { sessionNamespace: "synthetic-preserved-namespace", environment: "fixture" },
};
const context = vm.createContext({
  console: {
    log: (...args) => record("console-log", { text: args.join(" ") }),
    warn: (...args) => record("console-warn", { text: args.join(" ") }),
    error: (...args) => record("console-error", { text: args.join(" ") }),
  },
  process: {
    pid: process.pid,
    env: {},
    platform: fixturePlatform,
    kill(pid, signal) {
      record("pid-probe", { pid, signal });
      if (scenario === "stale-owner") throw codedError("ESRCH");
      if (scenario === "unknown-pid") throw codedError("EPERM");
    },
    on: (name, fn) => handlers.set(name, fn),
    exit(code) { record("exit", { code }); flush(); process.exit(code); },
  },
  setTimeout(fn, delay) { const id = ++nextTimer; timeouts.set(id, { fn, delay }); return id; },
  clearTimeout(id) { timeouts.delete(id); },
  setInterval() { return ++nextTimer; },
  clearInterval() {},
});

const modules = new Map();
function synthetic(identifier, exports) {
  if (!modules.has(identifier)) {
    modules.set(identifier, new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier }));
  }
  return modules.get(identifier);
}
const mocks = {
  "node:fs": { default: fakeFs },
  "node:child_process": {
    spawnSync(command, args, options) {
      if (command !== "/usr/bin/flock" || !leaseDescriptors.has(options.stdio[3]) || Object.keys(options.env).length) {
        throw new Error("Unexpected process or environment in kernel-lock fixture");
      }
      record("lease-probe");
      let result;
      if (scenario === "linux-lease-missing") result = { error: codedError("ENOENT"), status: null };
      else if (scenario === "linux-lease-uncertain") result = { error: codedError("EACCES"), status: null };
      else if (["linux-live-owner", "linux-same-pid-live-owner"].includes(scenario)) result = { status: 1 };
      else if (kernelCase && scenario !== "kernel-mutant") result = spawnSync(command, args, options);
      else result = { status: 0 };
      leaseHeld = !result.error && result.status === 0;
      return result;
    },
  },
  "node:crypto": { randomUUID: () => "synthetic-owner-id" },
  fs: { default: fakeFs },
  path: { default: path },
  "node-telegram-bot-api": { default: FakeTelegramBot },
  "./config.js": {
    getConfig: () => config,
    validateTelegramConfig() {},
    validateAgentRuntimeConfig() {},
    isManagedAgentsRuntime: () => true,
  },
  "./db.js": { getDb: () => { record("database-open"); return {}; } },
  "./health.js": { writeServiceHeartbeat: (_config, service, payload) => record("heartbeat", { service, status: payload.status }) },
  "./managed_agent_status.js": {
    MANAGED_AGENT_BRIDGE_SERVICE: "fixture-managed-bridge",
    resetIdleManagedAgentSessions: () => { record("idle-sweep"); return { checked: 0, reset: 0 }; },
  },
  "./sensitive_redaction.js": { redactSensitiveString: (text) => text },
  "./agent.js": { runAgentMessage: () => { throw new Error("Unexpected local runtime fallback"); } },
  "./managed_agent_bridge.js": {
    runManagedAgentMessage: async (args) => {
      record("managed-dispatch", { chatId: args.chatId, text: args.text });
      return "Your next assignment is the synthetic maths worksheet.";
    },
  },
};
const actual = new Set([
  "telegram_agent.js", "agent_runtime.js", "telegram_format.js", "telegram_queue.js", "telegram_threading.js", "text_utils.js",
  "telegram_process_lock.js",
]);
function source(filename) {
  if (!modules.has(filename)) {
    modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), { context, identifier: filename }));
  }
  return modules.get(filename);
}
async function linker(specifier, parent) {
  if (mocks[specifier]) return synthetic(specifier, mocks[specifier]);
  const filename = path.resolve(path.dirname(parent.identifier), specifier);
  if (!actual.has(path.basename(filename))) throw new Error(`Unmocked import: ${specifier}`);
  return source(filename);
}

try {
  const entry = fileURLToPath(new URL("../../src/telegram_agent.js", import.meta.url));
  const module = source(entry);
  await module.link(linker);
  await module.evaluate();
  if (["normal", "stale-owner", "linux-unrelated", "self-pid", "linux-self-pid", "signal-release", "replaced-owner-release"].includes(scenario)) {
    const message = { chat: { id: 7001 }, from: { is_bot: false }, message_id: 81, message_thread_id: 33, text: "What schoolwork is next?" };
    bot.emit("message", { ...message, chat: { id: 9999 } });
    bot.emit("message", { ...message, from: { is_bot: true } });
    bot.emit("message", message);
    bot.emit("message", message);
    const batch = [...timeouts.values()].find((timer) => timer.delay === 1200);
    if (!batch) throw new Error("Actual message handler did not schedule a batch");
    batch.fn();
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }
  if (scenario === "replaced-owner-release") fs.writeFileSync(lockPath, "replacement owner's lock");
  if (["signal-release", "replaced-owner-release", "linux-signal-release"].includes(scenario)) handlers.get("SIGTERM")();
  flush();
  if (scenario === "kernel-owner") {
    process.stdin.on("end", () => process.exit(97));
    process.stdin.resume();
  }
} catch (error) {
  record("unhandled", { text: error.message });
  flush();
  process.exitCode = 2;
}
