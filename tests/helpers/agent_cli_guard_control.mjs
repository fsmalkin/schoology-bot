import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readEnvValue } from "../../src/config.js";

const name = process.argv[2];
const sandbox = process.env.SCHOOLOGY_ROUTER_SANDBOX;
if (name === "network") await assert.rejects(() => fetch("https://provider-fixture.invalid/denied"), /ROUTER-GUARD-BLOCKED:network/);
else if (name === "file-env") assert.equal(readEnvValue("ANTHROPIC_API_KEY", "", { ANTHROPIC_API_KEY_FILE: path.join(sandbox, "forbidden/key") }), "");
else if (name === "dotenv") assert.throws(() => fs.readFileSync(path.join(sandbox, "forbidden/.env")), /ROUTER-GUARD-BLOCKED:dotenv-file/);
else if (name === "legacy") {
  const { runAgentMessage } = await import("../../src/agent.js");
  await assert.rejects(() => runAgentMessage({ chatId: "forbidden", text: "ping" }), /ROUTER-GUARD-BLOCKED:legacy-fallback/);
} else assert.fail("unknown guard control");
assert.equal(Object.values(globalThis.__schoologyRouterGuard.snapshot()).reduce((a, b) => a + b, 0), 1);
