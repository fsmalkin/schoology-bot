// Fixed-config, one-request bridge to the retained original tool engine.
import fs from "node:fs";
import { runSubscriptionToolCommand } from "../src/subscription_tools.js";
let raw = "";
try {
  if (process.argv.length !== 3) throw Error("Fixed configuration required");
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 32768) throw Error("Input too large"); }
  const input = JSON.parse(raw);
  if (input.command !== "execute") throw Error("Only allowlisted tool execution is exposed");
  const result = await runSubscriptionToolCommand({ ...config, allowedOperationNamespace: "schoology-plugin" }, input);
  process.stdout.write(JSON.stringify(result));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, code: "TOOL_UNAVAILABLE", reply: "The Schoology tool could not complete this operation. Check its saved operation before retrying." }));
  process.exitCode = 1;
}
