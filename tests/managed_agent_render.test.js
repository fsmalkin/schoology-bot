import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "scripts/managed_agents_admin.mjs");
const loader = new URL("./helpers/managed_render_no_services_loader.mjs", import.meta.url).href;
const preload = new URL("./helpers/managed_render_preload.mjs", import.meta.url).href;
// Generated from the pre-refactor pure definition bodies, without importing the runtime.
const originalHashes = {
  "agent/dev": "614afd48c8e92e0d8a0099236cef0a6f4d4abad3ebc0d67930c16a30c1026c62",
  "environment/dev": "c6497756308ed86b484e6e48a5a76fe04b957e18120bc93e443d2af94d586fb6",
  "agent/prod": "f5d96af516b64407e2563c4ee19670a54e0d2b1c22fc38a2a2b77d41292e55cd",
  "environment/prod": "19fd78c9e1db98fc8a68c5011df067fffef3604e9b657b3f32db3dc52c731d5b"
};
function environment(extra = {}) {
  const env = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "COMSPEC", "TEMP", "TMP"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return {
    ...env, NODE_NO_WARNINGS: "1",
    ANTHROPIC_API_KEY_FILE: path.join(os.tmpdir(), "schoology-render-protected-key"),
    CLAUDE_API_KEY_FILE: path.join(os.tmpdir(), "schoology-render-protected-alias"),
    ...extra,
  };
}
function run(args, extra = {}, entry = [cli]) {
  return spawnSync(process.execPath, ["--experimental-loader", loader, "--import", preload, ...entry, ...args], {
    cwd: root, env: environment(extra), encoding: "utf8", timeout: 10000,
  });
}

for (const env of ["dev", "prod"]) {
  for (const kind of ["agent", "environment"]) {
    test(`actual ${kind} render for ${env} preserves definition without secrets or runtime imports`, () => {
      const result = run([`render-${kind}`, env]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const definition = JSON.parse(result.stdout);
      const hash = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
      assert.equal(hash, originalHashes[`${kind}/${env}`]);
    });
  }
}

test("render guard rejects a dotenv import before it can read a selected env file", () => {
  const result = run([], {}, ["--input-type=module", "--eval", 'await import("dotenv/config")']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MANAGED-RENDER-IMPORT-BLOCKED: dotenv\/config/);
});

test("render guard observes and refuses a selected secret-file read", () => {
  const result = run([], {}, ["--input-type=module", "--eval",
    'import fs from "node:fs"; fs.readFileSync(process.env.ANTHROPIC_API_KEY_FILE)']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MANAGED-RENDER-SECRET-FILE-READ-BLOCKED/);
});

test("an API command still loads its selected dotenv config and uses the existing request contract", t => {
  const tempParent = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tempParent, "schoology-render-api-test-"));
  t.after(() => {
    const resolved = fs.realpathSync(dir);
    assert.equal(path.dirname(resolved), tempParent);
    assert.ok(path.basename(resolved).startsWith("schoology-render-api-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const envFile = path.join(dir, "synthetic.env");
  fs.writeFileSync(envFile, "ANTHROPIC_API_KEY=offline-test-key\nANTHROPIC_BASE_URL=https://offline.invalid\nCLAUDE_MANAGED_AGENTS_BETA=offline-beta\n");
  const result = run(["list-agents"], { SCHOOLOGY_RENDER_API_CONTROL: "1", DOTENV_CONFIG_PATH: envFile });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { data: [], control: {
    url: "https://offline.invalid/v1/agents", method: "GET", expectedKey: true,
    beta: "offline-beta", version: "2023-06-01",
  } });
});

test("an API command without a key still fails before the mocked transport", () => {
  const result = run(["list-agents"], {
    SCHOOLOGY_RENDER_API_CONTROL: "1",
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), "schoology-render-nonexistent.env"),
    ANTHROPIC_API_KEY_FILE: "", CLAUDE_API_KEY_FILE: "",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ANTHROPIC_API_KEY or CLAUDE_API_KEY is required/);
});
