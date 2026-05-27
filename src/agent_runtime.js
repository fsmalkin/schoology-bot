import { getConfig, isManagedAgentsRuntime } from "./config.js";
import { runAgentMessage } from "./agent.js";
import { runManagedAgentMessage } from "./managed_agent_bridge.js";

export async function runChatMessage({
  chatId,
  text,
  clientOverride = null,
  managedAgentClientOverride = null,
  now = null,
  debug = false,
} = {}) {
  const config = getConfig();
  if (isManagedAgentsRuntime(config)) {
    return await runManagedAgentMessage({
      chatId,
      text,
      clientOverride: managedAgentClientOverride || clientOverride,
      toolNow: now,
      debug,
    });
  }
  return await runAgentMessage({ chatId, text, clientOverride, now, debug });
}
