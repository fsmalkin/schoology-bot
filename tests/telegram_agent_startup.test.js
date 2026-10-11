import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildTelegramTargetKey } from "../src/telegram_threading.js";

const fixture = fileURLToPath(new URL("./helpers/telegram_agent_startup_fixture.mjs", import.meta.url));
function run(scenario) {
  const parent = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "schoology-startup-test-"));
  try {
    const result = spawnSync(process.execPath, ["--experimental-vm-modules", fixture, scenario, directory], {
      encoding: "utf8",
      timeout: 10000,
      env: { SystemRoot: process.env.SystemRoot || "", NODE_NO_WARNINGS: "1" },
    });
    assert.ifError(result.error);
    const report = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"));
    assert.equal(report.markerUnchanged, true, "Existing synthetic saved-state bytes changed");
    assert.equal(report.events.some((event) => event.type === "unhandled"), false, JSON.stringify(report.events));
    return { ...report, status: result.status, stderr: result.stderr };
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith("schoology-startup-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
function refused(report) {
  assert.equal(report.status, 1);
  for (const type of ["poller-construction", "heartbeat", "database-open", "idle-sweep", "log-write"]) {
    assert.equal(report.events.filter((event) => event.type === type).length, 0, `Started ${type} before lock ownership`);
  }
}

for (const scenario of ["live-owner", "unknown-pid", "malformed-lock", "invalid-pid", "read-denied", "linux-unreadable", "linux-live-owner", "linux-same-pid-live-owner", "linux-lease-missing", "linux-lease-uncertain", "linux-legacy-lock", "linux-lease-changed", "foreign-platform", "linux-foreign-platform"]) {
  test(`Telegram startup refuses ${scenario} before polling or state writes`, () => {
    const report = run(scenario);
    refused(report);
    assert.equal(report.lock, report.priorLock, "Changed an existing owner's lock");
    assert.equal(report.guard, null, "Left an owned acquisition claim");
  });
}
for (const scenario of ["write-denied", "concurrent-claim", "startup-claimed"]) {
  test(`Telegram startup refuses ${scenario} without a partial startup`, () => {
    const report = run(scenario);
    refused(report);
    if (scenario === "concurrent-claim") assert.equal(report.lock, "concurrent owner");
    if (scenario === "startup-claimed") assert.equal(report.guard, "another startup claim");
    else assert.equal(report.guard, null);
  });
}
for (const scenario of ["normal", "stale-owner", "linux-unrelated", "self-pid", "linux-self-pid"]) {
  test(`Telegram ${scenario} claims its lock before polling and routes one thread reply`, () => {
    const report = run(scenario);
    assert.equal(report.status, 0, report.stderr);
    const writes = report.events.filter((event) => event.type === "lock-write");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].exclusive, true, "Lock creation can overwrite another claim");
    const pollers = report.events.filter((event) => event.type === "poller-construction");
    assert.equal(pollers.length, 1);
    assert.equal(pollers[0].lockAlreadyPresent, true);
    assert.equal(pollers[0].claimReleased, true);
    if (scenario.startsWith("linux-")) assert.equal(pollers[0].leaseHeld, true);
    assert.ok(report.events.findIndex((event) => event.type === "lock-write") < report.events.findIndex((event) => event.type === "poller-construction"));
    assert.equal(report.guard, null);
    const dispatches = report.events.filter((event) => event.type === "managed-dispatch");
    assert.deepEqual(dispatches, [{ type: "managed-dispatch", chatId: buildTelegramTargetKey("7001", 33), text: "What schoolwork is next?" }]);
    const sends = report.events.filter((event) => event.type === "send");
    assert.equal(sends.length, 1, "Unauthorized, bot or duplicate input produced a reply");
    assert.equal(sends[0].chatId, "7001");
    assert.equal(sends[0].options.message_thread_id, 33);
    assert.match(sends[0].text, /synthetic maths worksheet/);
  });
}
test("Telegram shutdown removes only its own lock", () => {
  assert.equal(run("signal-release").lock, null);
  assert.equal(run("replaced-owner-release").lock, "replacement owner's lock");
  const linux = run("linux-signal-release");
  assert.equal(linux.lock, null);
  assert.equal(linux.events.some((event) => event.type === "lease-release"), false,
    "Released the process lease while a polling client still existed");
});
test("Telegram client construction failure releases the acquired lock", () => {
  const report = run("constructor-failure");
  assert.equal(report.status, 1);
  assert.equal(report.lock, null);
  assert.equal(report.guard, null);
  assert.equal(report.events.some((event) => event.type === "heartbeat"), false);
});
