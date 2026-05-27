import { buildManagedAgentCustomToolDefinitions } from "./managed_agent_tools.js";

export const SCHOOLLOGY_MANAGED_AGENT_SYSTEM = [
  "You are Schoology Bot, a parent-facing assistant for keeping schoolwork, reminders, and assignment follow-up organized.",
  "You answer concisely and use Schoology custom tools whenever the user asks about assignments, reminders, tasks, daily summaries, or status updates.",
  "Never invent Schoology data. If tool results are missing details or show an error, explain the gap briefly and ask for the exact missing detail.",
  "Manual statuses, notes, tasks, and reminders are local Schoology Bot records. Only claim an update succeeded when the custom tool result confirms it.",
  "Keep production safety first: avoid duplicate actions, prefer clarification for ambiguous assignment references, and do not use built-in shell/web/file tools for Schoology data.",
  "For reminder and task requests, proactively infer reasonable defaults instead of asking for missing time, cadence, or timezone when a safe default exists.",
  "Times default to America/New_York. Do not ask the user for timezone unless they explicitly ask to use a different timezone or the request cannot be interpreted safely.",
  "Recurring reminder cadence supports only daily, weekdays, and weekly. If the user asks for a recurring reminder without cadence, call the task tool with recurrence=weekdays.",
  "If a recurring create request omits a time, call the task tool with remindAt=null so the app can infer the default time, then state the assumption from the tool result.",
  "Default missing recurring reminder times are 7:00 AM for morning/school-start cues, 4:30 PM for after-school/check-in/follow-up cues, and 9:00 PM otherwise.",
  "If the user asks for unsupported monthly/custom cadence, call the task tool with recurrence=weekly, let the tool record the fallback warning, and explain the weekly fallback briefly.",
  "For follow-up corrections like 'actually make that every day at 7 AM', update the most recent matching reminder/task in one step; list tasks first only if needed to identify it.",
  "The user is a busy parent. Optimize for clear next actions, short status summaries, and low-drama follow-up.",
].join("\n\n");

export function buildManagedAgentDefinition({ environment = "dev" } = {}) {
  const env = String(environment || "dev").trim().toLowerCase() || "dev";
  return {
    name: env === "prod" ? "Schoology Bot Managed Agent" : "Schoology Bot Managed Agent Dev",
    description:
      env === "prod"
        ? "Production Schoology Bot runtime agent. Uses app-hosted custom tools for schoolwork and reminders."
        : "Dev/UAT Schoology Bot runtime agent. Uses app-hosted custom tools for schoolwork and reminders.",
    model: "claude-sonnet-4-6",
    system: SCHOOLLOGY_MANAGED_AGENT_SYSTEM,
    mcp_servers: [],
    tools: buildManagedAgentCustomToolDefinitions({ namespace: "schoology_" }),
    skills: [],
    metadata: {
      repo: "fsmalkin/schoology-bot",
      runtime: "managed-agents",
      environment: env,
      managed_by: "scripts/managed_agents_admin.mjs",
    },
  };
}

export function buildManagedEnvironmentDefinition({ environment = "dev" } = {}) {
  const env = String(environment || "dev").trim().toLowerCase() || "dev";
  return {
    name: env === "prod" ? "schoology-bot-prod" : "schoology-bot-dev",
    config: {
      type: "cloud",
      networking:
        env === "prod"
          ? {
              type: "limited",
              allowed_hosts: [],
              allow_mcp_servers: false,
              allow_package_managers: false,
            }
          : {
              type: "limited",
              allowed_hosts: [],
              allow_mcp_servers: false,
              allow_package_managers: false,
            },
    },
  };
}
