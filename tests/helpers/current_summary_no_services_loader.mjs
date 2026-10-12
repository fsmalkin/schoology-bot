const blocked = new Set([
  "config.js", "db.js", "storage.js", "tasks.js", "schoology.js",
  "telegram.js", "telegram_agent.js", "agent_runtime.js", "summary_agent.js",
]);
const services = /^(?:openai|@anthropic-ai\/sdk|better-sqlite3|node-telegram-bot-api|playwright)(?:\/|$)/;

export async function resolve(specifier, context, nextResolve) {
  let url;
  try { url = new URL(specifier, context.parentURL); } catch {}
  const basename = url?.pathname.split("/").pop();
  if (services.test(specifier) || (url?.pathname.includes("/src/") && blocked.has(basename))) {
    throw new Error("CURRENT-SUMMARY-SERVICE-IMPORT-BLOCKED");
  }
  return nextResolve(specifier, context);
}
