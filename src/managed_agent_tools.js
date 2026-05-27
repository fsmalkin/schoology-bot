import { toolDefinitions } from "./agent.js";
import { TOOL_NAMES } from "./tool_runner.js";

function normalizeNamespace(namespace) {
  const raw = String(namespace || "").trim();
  if (!raw) return "";
  if (raw.endsWith(".") || raw.endsWith("_") || raw.endsWith("-")) return raw;
  return `${raw}_`;
}

function toManagedAgentsInputSchema(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => toManagedAgentsInputSchema(item));
  }
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "additionalProperties") continue;
    next[key] = toManagedAgentsInputSchema(child);
  }
  return next;
}

export function buildManagedAgentCustomToolDefinitions({ namespace = "schoology_" } = {}) {
  const prefix = normalizeNamespace(namespace);
  const byName = new Map(toolDefinitions().map((tool) => [tool.name, tool]));
  byName.set("build_daily_summary", {
    name: "build_daily_summary",
    description: "Build the current daily Schoology summary without sending it.",
    parameters: {
      type: "object",
      properties: {
        now: {
          type: ["string", "null"],
          description: "Optional ISO datetime for deterministic summary generation.",
        },
        state: { type: ["object", "null"], description: "Optional state override for tests." },
      },
      required: ["now", "state"],
      additionalProperties: false,
    },
  });
  byName.set("drain_due_reminders", {
    name: "drain_due_reminders",
    description: "Drain due reminders and return the message payloads without sending Telegram messages.",
    parameters: {
      type: "object",
      properties: {
        now: {
          type: ["string", "null"],
          description: "Optional ISO datetime used as the reminder drain clock.",
        },
      },
      required: ["now"],
      additionalProperties: false,
    },
  });

  return TOOL_NAMES.map((toolName) => byName.get(toolName))
    .filter(Boolean)
    .map((tool) => ({
      type: "custom",
      name: `${prefix}${tool.name}`,
      description: tool.description,
      input_schema: toManagedAgentsInputSchema(tool.parameters) || {
        type: "object",
        properties: {},
      },
    }));
}
