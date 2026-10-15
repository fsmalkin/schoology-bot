import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(process.env.SCHOOLOGY_ROUTER_SOURCE);
const asUrl = name => pathToFileURL(path.join(root, name)).href;
const blockedEntries = new Set([
  "src/telegram_agent.js", "src/telegram_updates.js", "src/scheduler.js",
  "src/run.js", "src/interactive_login.js", "src/dashboard.js",
].map(asUrl));
const legacyUrl = asUrl("src/agent.js");
const toolsUrl = asUrl("src/tool_runner.js");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "openai" || specifier === "node-telegram-bot-api") {
    const kind = specifier === "openai" ? "model-construction" : "telegram-construction";
    const source = `export default class ForbiddenClient { constructor() { globalThis.__schoologyRouterGuard.deny(${JSON.stringify(kind)}); } }`;
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  }
  const result = await nextResolve(specifier, context);
  if (blockedEntries.has(result.url)) {
    process.stderr.write("ROUTER-SERVICE-IMPORT-BLOCKED\n");
    const error = new Error("ROUTER-SERVICE-IMPORT-BLOCKED");
    error.code = "ROUTER-SERVICE-IMPORT-BLOCKED";
    throw error;
  }
  return result;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  let anchor;
  let guard;
  if (url === legacyUrl) {
    anchor = "export async function runAgentMessage({ chatId, text, clientOverride, now = null, debug = false }) {";
    // A selected legacy route can return a controlled fake, never run its body.
    guard = '\n  return globalThis.__schoologyCliFixture.legacy({ chatId, text });';
  } else if (url === toolsUrl) {
    anchor = "export async function runToolByName(db, toolName, args, context = {}) {";
    guard = '\n  if (toolName !== "list_assignments") globalThis.__schoologyRouterGuard.deny("unselected-tool");';
  } else {
    return result;
  }
  const source = String(result.source);
  if (source.split(anchor).length !== 2) throw new Error(`ROUTER-GUARD-ANCHOR-MISMATCH ${path.basename(fileURLToPath(url))}`);
  return { ...result, source: source.replace(anchor, anchor + guard) };
}
