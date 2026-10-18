import fs from "node:fs";
import { runSubscriptionToolCommand } from "../src/subscription_tools.js";
let raw = "";
try {
  if (process.argv.length !== 3) throw Error("Fixed private tool configuration required");
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1024 * 1024) throw Error("Tool input too large"); }
  const result = await runSubscriptionToolCommand(config, JSON.parse(raw));
  process.stdout.write(JSON.stringify(result));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, reply: "The local Schoology tool could not complete this request. No success is claimed; the saved operation must be checked before retrying." }));
  process.exitCode = 1;
}
