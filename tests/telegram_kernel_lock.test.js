import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const enabled = process.env.TELEGRAM_PID_NAMESPACE_TEST === "1";
const fixture = fileURLToPath(new URL("./helpers/telegram_agent_startup_fixture.mjs", import.meta.url));
const environment = { PATH: "/usr/bin:/bin", NODE_NO_WARNINGS: "1" };
function command(scenario, directory) {
  return ["-n", "/usr/bin/unshare", "--pid", "--fork", "--kill-child",
    process.execPath, "--experimental-vm-modules", fixture, scenario, directory];
}
function attempt(scenario, directory) {
  const result = spawnSync("/usr/bin/sudo", command(scenario, directory), {
    env: environment, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(result.error);
  assert.ok(result.stdout.trim(), result.stderr);
  return { ...JSON.parse(result.stdout.trim()), status: result.status };
}
function refusal(report, lock) {
  assert.equal(report.namespacePid, 1);
  assert.equal(report.status, 1);
  assert.equal(report.lock, lock, "Contender changed the live owner's PID record");
  for (const type of ["poller-construction", "database-open", "heartbeat", "idle-sweep", "log-write"]) {
    assert.equal(report.events.some((event) => event.type === type), false, `Contender started ${type}`);
  }
}
function signalOwner(ownerReport, signal) {
  const pid = ownerReport.hostPid;
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const fields = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  assert.equal(fields[19], ownerReport.startTicks, "Owned process identity changed");
  const result = spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/kill", `-${signal}`, "--", String(pid)], {
    env: environment, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

test("shared kernel lease excludes identical container PIDs through pause, crash and restart", {
  skip: !enabled,
  timeout: 60000,
}, async () => {
  assert.equal(process.platform, "linux", "Required namespace control needs Linux");
  const parent = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "schoology-kernel-test-"));
  const owner = spawn("/usr/bin/sudo", command("kernel-owner", directory), {
    env: environment, stdio: ["pipe", "pipe", "pipe"],
  });
  const exit = once(owner, "exit");
  const lines = createInterface({ input: owner.stdout });
  let stderr = "";
  owner.stderr.on("data", (chunk) => { stderr += chunk; });
  owner.stdin.on("error", () => {});
  let ownerReport;
  let paused = false;
  try {
    const line = await Promise.race([
      once(lines, "line").then(([value]) => value),
      exit.then(() => { throw new Error(`Owner exited before readiness: ${stderr}`); }),
    ]);
    ownerReport = JSON.parse(line);
    assert.equal(ownerReport.namespacePid, 1);
    assert.equal(ownerReport.events.filter((event) => event.type === "poller-construction").length, 1);
    assert.equal(ownerReport.events.find((event) => event.type === "poller-construction").leaseHeld, true);
    refusal(attempt("kernel-contender", directory), ownerReport.lock);
    signalOwner(ownerReport, "STOP");
    paused = true;
    refusal(attempt("kernel-contender", directory), ownerReport.lock);
    signalOwner(ownerReport, "CONT");
    paused = false;

    // A controlled dependency mutant reports a lease without taking flock.
    // The same refusal instrument must detect its second polling client.
    const mutant = attempt("kernel-mutant", directory);
    assert.equal(mutant.namespacePid, 1);
    assert.equal(mutant.events.filter((event) => event.type === "poller-construction").length, 1);
    assert.throws(() => refusal(mutant, ownerReport.lock), assert.AssertionError);
    console.log("TELEGRAM-KERNEL-LEASE-MUTANT-CAUGHT");

    signalOwner(ownerReport, "KILL");
    await exit;
    const retained = fs.readFileSync(path.join(directory, "telegram_agent.lock"), "utf8");
    assert.equal(JSON.parse(retained).pid, 1);
    const restarted = attempt("kernel-restart", directory);
    assert.equal(restarted.namespacePid, 1);
    assert.equal(restarted.status, 0);
    assert.equal(restarted.events.filter((event) => event.type === "poller-construction").length, 1);
    assert.equal(restarted.events.find((event) => event.type === "poller-construction").leaseHeld, true);
    assert.equal(restarted.markerUnchanged, true);
    console.log("TELEGRAM-KERNEL-LEASE-NAMESPACE-PASS");
  } finally {
    if (paused && ownerReport && owner.exitCode === null) signalOwner(ownerReport, "CONT");
    if (owner.exitCode === null && owner.signalCode === null) {
      owner.stdin.end();
      await exit;
    }
    lines.close();
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith("schoology-kernel-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
