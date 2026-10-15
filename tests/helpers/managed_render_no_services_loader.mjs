const blockedFiles = new Set([
  "agent.js", "config.js", "db.js", "storage.js", "tool_runner.js", "tasks.js",
  "schoology.js", "telegram.js", "telegram_agent.js", "agent_runtime.js",
]);
const blockedPackages = /^(?:openai|@anthropic-ai\/sdk|better-sqlite3|node-telegram-bot-api|playwright)(?:\/|$)/;

export async function resolve(specifier, context, nextResolve) {
  let url;
  try { url = new URL(specifier, context.parentURL); } catch {}
  const basename = url?.pathname.split("/").pop();
  if (
    (specifier.startsWith("dotenv") && process.env.SCHOOLOGY_RENDER_API_CONTROL !== "1") ||
    blockedPackages.test(specifier) ||
    (url?.pathname.includes("/src/") && blockedFiles.has(basename))
  ) throw new Error(`MANAGED-RENDER-IMPORT-BLOCKED: ${specifier}`);
  return nextResolve(specifier, context);
}
