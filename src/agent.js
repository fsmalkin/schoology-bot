import "dotenv/config";
import OpenAI from "openai";
import { getConfig, validateOpenAIConfig } from "./config.js";
import {
  addAssignmentNote,
  ensureDbSeeded,
  getChatState,
  getDb,
  listAssignments,
  listTasks,
  createTask,
  updateTaskStatus,
  updateTask,
  deleteTask,
  applyNumberedStatuses,
  resetChatState,
  scheduleReminder,
  listReminders,
  updateReminder,
  deleteReminder,
  listResolvedWithManualStatus,
  clearManualStatuses,
  updateAssignmentStatus,
  updateAssignmentStatuses,
  getPendingAction,
  setPendingAction,
  clearPendingAction,
  updateChatCompaction,
  updateChatState,
} from "./db.js";
import { openBugReport, openFeatureRequest } from "./bugs.js";
import { statusGuideText, isIgnoredStatus, isPendingStatus } from "./statuses.js";
import { isRepetitiveOutput, isToolingLoop, normalizeAscii, sanitizeRepeatedText } from "./text_utils.js";
import { runScrape } from "./tasks.js";

function buildResponsePrompt() {
  return [
    "You are a Schoology assistant.",
    "Use the provided tool results as the source of truth.",
    "Never claim updates unless tool results confirm success.",
    "If tool results include errors, explain them briefly and ask for the missing detail.",
    "When talking about tasks or assignment reminders, use the term 'Reminders' and combine them unless the user asks for a specific type.",
    "If a note implies a follow-up action, ask if the user wants a reminder created.",
    `Manual status codes: ${statusGuideText()}.`,
    "Default reporting buckets: Actionable, Pending, Ignored. Hide Ignored by default unless asked.",
    "When confirming status updates, include a short list of items waiting on teacher/grade (No grade put in yet, Waiting on teacher).",
    "If the user suggests improvements or feature ideas, ask if they want you to log a feature request.",
    "Return a JSON object with a single key \"message\" containing your reply.",
    "Inside message, use plain text with simple lists (use '-' for bullets, '1.' for numbering).",
    "Do not use HTML tags or Markdown code fences inside the message.",
    "Do not mention tool calls or function names.",
    "Keep responses concise and action-oriented.",
  ].join(" ");
}


function deepClone(value) {
  if (Array.isArray(value)) return value.map((item) => deepClone(item));
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, val]) => [key, deepClone(val)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function allowNullValue(prop) {
  const next = deepClone(prop);
  if (next && typeof next === "object") {
    if (Array.isArray(next.enum) && !next.enum.includes(null)) {
      next.enum = [...next.enum, null];
    }
    if (Array.isArray(next.type)) {
      if (!next.type.includes("null")) next.type = [...next.type, "null"];
    } else if (typeof next.type === "string") {
      next.type = [next.type, "null"];
    }
  }
  return next;
}

function buildStrictParams(properties, requiredKeys = []) {
  const allKeys = Object.keys(properties);
  const requiredSet = new Set(requiredKeys);
  const nextProps = {};
  for (const [key, prop] of Object.entries(properties)) {
    nextProps[key] = requiredSet.has(key) ? deepClone(prop) : allowNullValue(prop);
  }
  return {
    type: "object",
    properties: nextProps,
    required: allKeys,
    additionalProperties: false,
  };
}

const TOOL_NAMES = [
  "list_assignments",
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "apply_numbered_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "list_assignment_reminders",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "refresh_schoology",
  "create_task",
  "list_tasks",
  "update_task_status",
  "update_task",
  "delete_task",
  "open_bug_report",
  "open_feature_request",
];

const TOOL_GROUPS = {
  assignments: [
    "list_assignments",
    "update_assignment_status",
    "bulk_update_assignment_statuses",
    "apply_numbered_statuses",
    "add_assignment_note",
    "schedule_reminder",
    "list_assignment_reminders",
    "update_assignment_reminder",
    "delete_assignment_reminder",
    "refresh_schoology",
  ],
  tasks: ["create_task", "list_tasks", "update_task_status", "update_task", "delete_task"],
  bugs: ["open_bug_report", "open_feature_request"],
};

function normalizeToolName(value, allowedTools = TOOL_NAMES) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (allowedTools.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const direct = allowedTools.find((name) => name.toLowerCase() === lower);
  if (direct) return direct;
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const matched = allowedTools.find(
    (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === compact
  );
  return matched || null;
}

export function toolDefinitions() {
  return [
    {
      type: "function",
      name: "list_assignments",
      description: "List assignments with optional filters.",
      strict: true,
      parameters: buildStrictParams({
        status: {
          type: "string",
          enum: ["missing", "resolved", "all"],
          description: "Filter by missing/resolved/all.",
        },
        course: {
          type: "string",
          description: "Filter by course name (substring).",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Max number of assignments to return.",
        },
        includeIgnored: {
          type: "boolean",
          description: "Include ignored manual statuses (default false).",
        },
        includePending: {
          type: "boolean",
          description: "Include pending manual statuses (default true).",
        },
        bucketed: {
          type: "boolean",
          description: "Return assignments grouped into actionable/pending/ignored buckets.",
        },
      }),
    },
    {
      type: "function",
      name: "update_assignment_status",
      description: "Set a manual status for an assignment.",
      strict: true,
      parameters: buildStrictParams(
        {
          key: { type: "string", description: "Assignment key." },
          title: { type: "string", description: "Assignment title to match." },
          course: { type: "string", description: "Course name to match." },
          status: { type: "string", description: "New status text." },
        },
        ["status"]
      ),
    },
    {
      type: "function",
      name: "bulk_update_assignment_statuses",
      description: "Set manual statuses for multiple assignments at once.",
      strict: true,
      parameters: buildStrictParams(
        {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                title: { type: "string" },
                course: { type: "string" },
                status: { type: "string" },
              },
              required: ["key", "title", "course", "status"],
              additionalProperties: false,
            },
          },
        },
        ["updates"]
      ),
    },
    {
      type: "function",
      name: "apply_numbered_statuses",
      description: "Apply statuses by index using the current missing list ordering.",
      strict: true,
      parameters: buildStrictParams(
        {
          listStatus: {
            type: "string",
            enum: ["missing", "resolved", "all"],
            description: "Which list ordering to use (default missing).",
          },
          statusByIndex: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer", minimum: 1 },
                status: { type: "string" },
              },
              required: ["index", "status"],
              additionalProperties: false,
            },
          },
        },
        ["statusByIndex"]
      ),
    },
    {
      type: "function",
      name: "add_assignment_note",
      description: "Add a note to an assignment.",
      strict: true,
      parameters: buildStrictParams(
        {
          key: { type: "string", description: "Assignment key." },
          title: { type: "string", description: "Assignment title to match." },
          course: { type: "string", description: "Course name to match." },
          note: { type: "string", description: "Note text." },
        },
        ["note"]
      ),
    },
    {
      type: "function",
      name: "schedule_reminder",
      description: "Schedule a reminder for an assignment.",
      strict: true,
      parameters: buildStrictParams(
        {
          key: { type: "string", description: "Assignment key." },
          title: { type: "string", description: "Assignment title to match." },
          course: { type: "string", description: "Course name to match." },
          remindAt: {
            type: "string",
            description: "Reminder time in ISO-8601 format.",
          },
          message: {
            type: "string",
            description: "Optional reminder message.",
          },
          replaceExisting: {
            type: "boolean",
            description: "Replace existing pending reminder(s) for the same assignment.",
          },
        },
        ["remindAt"]
      ),
    },
    {
      type: "function",
      name: "list_assignment_reminders",
      description: "List reminders for an assignment.",
      strict: true,
      parameters: buildStrictParams(
        {
          key: { type: "string", description: "Assignment key." },
          status: { type: "string", enum: ["pending", "sent", "all"] },
        },
        ["key"]
      ),
    },
    {
      type: "function",
      name: "update_assignment_reminder",
      description: "Update a reminder time or message.",
      strict: true,
      parameters: buildStrictParams(
        {
          id: { type: "integer", description: "Reminder id." },
          remindAt: { type: "string", description: "Reminder time in ISO-8601 format." },
          message: { type: "string", description: "Reminder message." },
        },
        ["id"]
      ),
    },
    {
      type: "function",
      name: "delete_assignment_reminder",
      description: "Delete a reminder.",
      strict: true,
      parameters: buildStrictParams(
        {
          id: { type: "integer", description: "Reminder id." },
        },
        ["id"]
      ),
    },
    {
      type: "function",
      name: "refresh_schoology",
      description: "Run a fresh Schoology scrape and reconcile manual statuses using the safe policy.",
      strict: true,
      parameters: buildStrictParams({
        notes: { type: "string", description: "Optional reason or note for audit." },
      }),
    },
    {
      type: "function",
      name: "create_task",
      description: "Create a personal task with a reminder.",
      strict: true,
      parameters: buildStrictParams(
        {
          title: { type: "string", description: "Task title." },
          remindAt: { type: "string", description: "Reminder time in ISO-8601 format." },
          message: { type: "string", description: "Optional reminder note." },
        },
        ["title", "remindAt"]
      ),
    },
    {
      type: "function",
      name: "list_tasks",
      description: "List tasks with optional filters.",
      strict: true,
      parameters: buildStrictParams({
        status: {
          type: "string",
          enum: ["pending", "done", "all"],
          description: "Filter by status.",
        },
        start: { type: "string", description: "ISO start datetime filter." },
        end: { type: "string", description: "ISO end datetime filter." },
      }),
    },
    {
      type: "function",
      name: "update_task_status",
      description: "Mark a task as done or pending.",
      strict: true,
      parameters: buildStrictParams(
        {
          id: { type: "integer", description: "Task id." },
          status: { type: "string", description: "done or pending." },
        },
        ["id", "status"]
      ),
    },
    {
      type: "function",
      name: "update_task",
      description: "Update a task title, reminder time, or note.",
      strict: true,
      parameters: buildStrictParams(
        {
          id: { type: "integer", description: "Task id." },
          title: { type: "string", description: "Task title." },
          remindAt: { type: "string", description: "Reminder time in ISO-8601 format." },
          message: { type: "string", description: "Optional reminder note." },
        },
        ["id"]
      ),
    },
    {
      type: "function",
      name: "delete_task",
      description: "Delete a task.",
      strict: true,
      parameters: buildStrictParams(
        {
          id: { type: "integer", description: "Task id." },
        },
        ["id"]
      ),
    },
    {
      type: "function",
      name: "open_bug_report",
      description: "Log a bug locally and optionally open a GitHub issue.",
      strict: true,
      parameters: buildStrictParams(
        {
          title: { type: "string", description: "Short bug title." },
          body: { type: "string", description: "Bug details and steps to reproduce." },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional GitHub labels.",
          },
        },
        ["title", "body"]
      ),
    },
    {
      type: "function",
      name: "open_feature_request",
      description: "Log a feature request locally and optionally open a GitHub issue.",
      strict: true,
      parameters: buildStrictParams(
        {
          title: { type: "string", description: "Short request title." },
          body: { type: "string", description: "Request details and desired outcome." },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional GitHub labels.",
          },
        },
        ["title", "body"]
      ),
    },
  ];
}

function extractText(response) {
  if (response?.output_text) return response.output_text;
  const output = response?.output;
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      if (!item) return "";
      if (item.type === "output_text" && item.text) return item.text;
      if (item.type === "message" && Array.isArray(item.content)) {
        return item.content
          .map((part) => (part?.text ? part.text : ""))
          .join("");
      }
      return "";
    })
    .join("");
}

function parseResponseMessage(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.message === "string") return parsed.message.trim();
      if (typeof parsed.text === "string") return parsed.text.trim();
      if (typeof parsed.reply === "string") return parsed.reply.trim();
    }
  } catch (err) {
    // fall through
  }

  const messageMatch = trimmed.match(/"message"\s*:\s*"([\s\S]*)$/);
  if (messageMatch) {
    let candidate = messageMatch[1];
    candidate = candidate.replace(/"\s*}[\s\S]*$/, "");
    candidate = candidate.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
    return candidate.trim();
  }

  return trimmed;
}

function parseArguments(args) {
  if (!args) return {};
  if (typeof args === "object") return args;
  try {
    return JSON.parse(args);
  } catch (err) {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("server error") ||
    message.includes("temporarily") ||
    message.includes("timeout") ||
    message.includes("try again")
  );
}

async function createResponseWithRetry(client, payload, retries = 2, baseDelayMs = 600) {
  let attempt = 0;
  while (true) {
    try {
      return await client.responses.create(payload);
    } catch (err) {
      if (!isRetryableError(err) || attempt >= retries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await sleep(delay);
      attempt += 1;
    }
  }
}

function parsePlanArgs(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return null;
  }
}

function normalizeToolPlan(raw, allowedTools = TOOL_NAMES) {
  const plan = raw && typeof raw === "object" ? raw : {};
  let action =
    typeof plan.action === "string" && ["call_tool", "call_tools"].includes(plan.action)
      ? plan.action
      : "call_tool";
  const tool = normalizeToolName(plan.tool, allowedTools);
  const args = parsePlanArgs(plan.args);
  const calls = Array.isArray(plan.calls)
    ? plan.calls
        .map((call) => {
          if (!call || typeof call !== "object") return null;
          const name = normalizeToolName(call.tool, allowedTools);
          const callArgs = parsePlanArgs(call.args);
          if (!name) return null;
          return { tool: name, args: callArgs || {} };
        })
        .filter(Boolean)
    : null;
  const resolvedTool = tool || (calls && calls.length > 0 ? calls[0].tool : null);
  if (action === "call_tools" && (!calls || calls.length === 0)) {
    action = "call_tool";
  }
  return { action, tool: resolvedTool, args, calls };
}

function buildToolGroupSchema() {
  return {
    type: "object",
    properties: {
      group: {
        type: "string",
        enum: ["assignments", "tasks", "bugs", "none"],
      },
      reason: { type: "string" },
    },
    required: ["group", "reason"],
    additionalProperties: false,
  };
}

function buildToolPlanSchema(allowedTools = TOOL_NAMES) {
  return {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["call_tool", "call_tools"],
      },
      tool: {
        type: "string",
        enum: allowedTools,
      },
      args: {
        type: ["string", "null"],
        description: "JSON string with arguments for the single tool call.",
      },
      calls: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              enum: allowedTools,
            },
            args: {
              type: ["string", "null"],
            },
          },
          required: ["tool", "args"],
          additionalProperties: false,
        },
      },
    },
    required: ["action", "tool", "args", "calls"],
    additionalProperties: false,
  };
}

function buildToolGroupInstructions() {
  return [
    "Return JSON only. No extra text.",
    "Pick group=assignments for Schoology, assignments, grades, missing work, reminders, notes, status updates, refresh/sync.",
    "Pick group=tasks for personal tasks/reminders not tied to assignments.",
    "Pick group=bugs for requests to file bugs or feature requests.",
    "Pick group=none only for greetings, thanks, or small talk.",
    "If unsure, choose group=assignments.",
  ].join(" ");
}

function buildToolPlanInstructions(allowedTools = TOOL_NAMES) {
  return [
    "Return JSON only. No extra text.",
    "Choose the single best tool (or multiple tools) to satisfy the user request.",
    "Always call tools for assignment/reminder/task data. Do not respond with the answer.",
    "If exactly one tool is needed, use action=call_tool with tool + args.",
    "If multiple tools are needed, use action=call_tools with calls in order.",
    "Always set tool to the primary tool (for call_tools, use the first tool in calls).",
    "For args, provide a JSON string like \"{}\" or \"{\\\"status\\\":\\\"missing\\\"}\".",
    `Allowed tools: ${allowedTools.join(", ")}.`,
    "Examples:",
    "User: refresh my assignments -> {\"action\":\"call_tool\",\"tool\":\"refresh_schoology\",\"args\":\"{}\",\"calls\":null}",
    "User: refresh and list missing -> {\"action\":\"call_tools\",\"tool\":null,\"args\":null,\"calls\":[{\"tool\":\"refresh_schoology\",\"args\":\"{}\"},{\"tool\":\"list_assignments\",\"args\":\"{\\\"status\\\":\\\"missing\\\",\\\"includePending\\\":true,\\\"includeIgnored\\\":false,\\\"bucketed\\\":true}\"}]}",
    "User: what are my missing assignments -> {\"action\":\"call_tool\",\"tool\":\"list_assignments\",\"args\":\"{\\\"status\\\":\\\"missing\\\",\\\"includePending\\\":true,\\\"includeIgnored\\\":false,\\\"bucketed\\\":true}\",\"calls\":null}",
  ].join(" ");
}

function buildToolAugmentSchema(allowedTools = TOOL_NAMES) {
  return {
    type: "object",
    properties: {
      add_calls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", enum: allowedTools },
            args: { type: ["string", "null"] },
          },
          required: ["tool", "args"],
          additionalProperties: false,
        },
      },
      reason: { type: "string" },
    },
    required: ["add_calls", "reason"],
    additionalProperties: false,
  };
}

function buildToolAugmentInstructions() {
  return [
    "Return JSON only. No extra text.",
    "You are checking if the current tool plan fully satisfies the user request.",
    "If additional tools are needed, return them in add_calls in the order they should run AFTER the current plan.",
    "If no additional tools are needed, return an empty add_calls array.",
    "Only add tools if the user explicitly asked for extra actions beyond the current plan.",
    "For args, provide a JSON string like \"{}\" or \"{\\\"status\\\":\\\"missing\\\"}\".",
  ].join(" ");
}

async function pickToolGroup(client, config, text, previousResponseId) {
  const schema = buildToolGroupSchema();
  const response = await createResponseWithRetry(client, {
    model: config.openai.model,
    reasoning: { effort: "low" },
    max_output_tokens: 120,
    instructions: buildToolGroupInstructions(),
    input: text,
    text: {
      format: {
        type: "json_schema",
        name: "tool_group",
        strict: true,
        schema,
      },
    },
    tool_choice: "none",
    parallel_tool_calls: false,
    previous_response_id: previousResponseId || undefined,
  });

  const raw = extractText(response);
  try {
    const parsed = JSON.parse(raw);
    const group = typeof parsed?.group === "string" ? parsed.group : "assignments";
    if (["assignments", "tasks", "bugs", "none"].includes(group)) return group;
    return "assignments";
  } catch (err) {
    return "assignments";
  }
}

async function pickToolPlan(client, config, text, previousResponseId, allowedTools = TOOL_NAMES) {
  const schema = buildToolPlanSchema(allowedTools);
  const runPlan = async (instructions, name) => {
    const response = await createResponseWithRetry(client, {
      model: config.openai.model,
      reasoning: { effort: "low" },
      max_output_tokens: 280,
      instructions,
      input: text,
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
      tool_choice: "none",
      parallel_tool_calls: false,
      previous_response_id: previousResponseId || undefined,
    });
    const raw = extractText(response);
    try {
      const parsed = JSON.parse(raw);
      return normalizeToolPlan(parsed, allowedTools);
    } catch (err) {
      return normalizeToolPlan(null, allowedTools);
    }
  };

  const first = await runPlan(buildToolPlanInstructions(allowedTools), "tool_plan");
  const isValidFirst =
    first.tool && (first.action === "call_tool" || (first.action === "call_tools" && first.calls));
  if (isValidFirst) return first;

  const retryInstructions = `${buildToolPlanInstructions(allowedTools)} Tool must be one of: ${allowedTools.join(
    ", "
  )}. Tool cannot be null.`;
  return await runPlan(retryInstructions, "tool_plan_retry");
}

async function augmentToolPlan(client, config, text, plan, previousResponseId, allowedTools = TOOL_NAMES) {
  if (!plan || plan.action !== "call_tool" || !plan.tool) return plan;
  const schema = buildToolAugmentSchema(allowedTools);
  const input = `User message:\n${text}\n\nCurrent plan:\n${JSON.stringify({
    action: plan.action,
    tool: plan.tool,
    args: plan.args || {},
  })}`;
  const response = await createResponseWithRetry(client, {
    model: config.openai.model,
    reasoning: { effort: "low" },
    max_output_tokens: 200,
    instructions: buildToolAugmentInstructions(),
    input,
    text: {
      format: {
        type: "json_schema",
        name: "tool_augments",
        strict: true,
        schema,
      },
    },
    tool_choice: "none",
    parallel_tool_calls: false,
    previous_response_id: previousResponseId || undefined,
  });

  const raw = extractText(response);
  try {
    const parsed = JSON.parse(raw);
    const addCalls = Array.isArray(parsed?.add_calls)
      ? parsed.add_calls
          .map((call) => {
            if (!call || typeof call !== "object") return null;
            const name = normalizeToolName(call.tool, allowedTools);
            const callArgs = parsePlanArgs(call.args);
            if (!name) return null;
            return { tool: name, args: callArgs || {} };
          })
          .filter(Boolean)
      : [];
    if (addCalls.length === 0) return plan;
    return {
      action: "call_tools",
      tool: plan.tool,
      args: plan.args,
      calls: [{ tool: plan.tool, args: plan.args || {} }, ...addCalls],
    };
  } catch (err) {
    return plan;
  }
}

export async function planAction(client, config, text, previousResponseId, allowedToolsOverride = null) {
  if (Array.isArray(allowedToolsOverride) && allowedToolsOverride.length > 0) {
    const allowedTools = allowedToolsOverride;
    const plan = await pickToolPlan(client, config, text, previousResponseId, allowedTools);
    const augmented = await augmentToolPlan(client, config, text, plan, previousResponseId, allowedTools);
    const fallbackTool = allowedTools[0] || "list_assignments";
    const finalPlan =
      augmented.tool || (augmented.calls && augmented.calls.length > 0)
        ? augmented
        : { action: "call_tool", tool: fallbackTool, args: {}, calls: null };
    return {
      action: finalPlan.action,
      tool: finalPlan.tool,
      args: finalPlan.args,
      calls: finalPlan.calls,
      message: null,
    };
  }

  const group = await pickToolGroup(client, config, text, previousResponseId);
  if (group === "none") {
    return { action: "respond", tool: null, args: null, calls: null, message: null };
  }
  const allowedTools = TOOL_GROUPS[group] || TOOL_NAMES;
  const plan = await pickToolPlan(client, config, text, previousResponseId, allowedTools);
  const augmented = await augmentToolPlan(client, config, text, plan, previousResponseId, allowedTools);
  const fallbackTool =
    allowedTools.includes("list_assignments")
      ? "list_assignments"
      : allowedTools[0] || "list_assignments";
  const finalPlan =
    augmented.tool || (augmented.calls && augmented.calls.length > 0)
      ? augmented
      : { action: "call_tool", tool: fallbackTool, args: {}, calls: null };
  return {
    action: finalPlan.action,
    tool: finalPlan.tool,
    args: finalPlan.args,
    calls: finalPlan.calls,
    message: null,
  };
}

function normalizeToolArgs(toolName, args) {
  const tool = toolDefinitions().find((entry) => entry.name === toolName);
  const props = tool?.parameters?.properties;
  const base = args && typeof args === "object" ? args : {};
  if (!props || typeof props !== "object") return base;
  const filled = {};
  for (const key of Object.keys(props)) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      filled[key] = base[key];
    } else {
      filled[key] = null;
    }
  }
  return filled;
}

function buildFinalInput(text, draftMessage, toolResults) {
  const parts = [`User message:\\n${text}`];
  if (toolResults && toolResults.length > 0) {
    parts.push(`Tool results (JSON):\\n${JSON.stringify(toolResults)}`);
  }
  if (draftMessage) {
    parts.push(`Draft response (use if helpful):\\n${draftMessage}`);
  }
  return parts.join("\\n\\n");
}

function hasWriteTool(executed) {
  const writeTools = new Set([
    "update_assignment_status",
    "bulk_update_assignment_statuses",
    "apply_numbered_statuses",
    "add_assignment_note",
    "schedule_reminder",
    "update_assignment_reminder",
    "delete_assignment_reminder",
    "refresh_schoology",
    "create_task",
    "update_task_status",
    "update_task",
    "delete_task",
    "open_bug_report",
    "open_feature_request",
  ]);
  return executed.some((item) => writeTools.has(item.call?.name));
}

function buildPlanInput(text, pending) {
  if (!pending) return text;
  const pendingSummary = {
    tool: pending.tool,
    args: pending.args || {},
    note: pending.note || "",
    matches: pending.matches || null,
  };
  return [
    "Pending action (use only if the user is confirming or providing missing details):",
    JSON.stringify(pendingSummary),
    "User message:",
    text,
  ].join("\\n");
}

function buildPendingDecisionSchema() {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["proceed", "cancel"] },
      reason: { type: "string" },
    },
    required: ["action", "reason"],
    additionalProperties: false,
  };
}

function buildPendingDecisionInstructions() {
  return [
    "Return JSON only. No extra text.",
    "You decide whether the user message is confirming/providing details for the pending action.",
    "If the user wants to proceed, return action=proceed.",
    "If the user is cancelling or changing topics, return action=cancel.",
  ].join(" ");
}

async function decidePendingAction(client, config, pending, text, previousResponseId) {
  const schema = buildPendingDecisionSchema();
  const input = buildPlanInput(text, pending);
  const response = await createResponseWithRetry(client, {
    model: config.openai.model,
    reasoning: { effort: "low" },
    max_output_tokens: 120,
    instructions: buildPendingDecisionInstructions(),
    input,
    text: {
      format: {
        type: "json_schema",
        name: "pending_decision",
        strict: true,
        schema,
      },
    },
    tool_choice: "none",
    parallel_tool_calls: false,
    previous_response_id: previousResponseId || undefined,
  });

  const raw = extractText(response);
  try {
    const parsed = JSON.parse(raw);
    return parsed?.action === "cancel" ? "cancel" : "proceed";
  } catch (err) {
    return "proceed";
  }
}

function mergePendingArgs(pendingArgs, newArgs) {
  const base = pendingArgs && typeof pendingArgs === "object" ? pendingArgs : {};
  const updates = newArgs && typeof newArgs === "object" ? newArgs : {};
  return { ...base, ...updates };
}

function shouldStorePendingAction(toolName, output) {
  if (!toolName || !output || output.ok !== false) return false;
  const message = String(output.error || "").toLowerCase();
  if (message.includes("assignment key or title is required")) return true;
  if (message.includes("multiple assignments match")) return true;
  if (message.includes("no matching assignments")) return true;
  return false;
}

function formatAssignmentLabel(assignment) {
  if (!assignment) return "Unknown assignment";
  const course = assignment.course ? `${assignment.course}` : "Unknown course";
  const title = assignment.title ? `${assignment.title}` : "Untitled";
  return `${course} - ${title}`;
}

function formatUpdateSummary(results, db) {
  const applied = [];
  const needs = [];
  const info = [];

  for (const item of results) {
    const name = item.call?.name;
    const output = item.output || {};
    const args = parseArguments(item.call?.arguments);

    if (name === "open_bug_report" || name === "open_feature_request") {
      if (output?.issue?.ok) {
        info.push(`Created issue: ${output.issue.url}`);
      } else if (output?.logged) {
        info.push(`Logged locally: ${output.logPath || "data/bugs.log"}`);
      } else if (output?.issue?.error) {
        needs.push(`Could not file issue: ${output.issue.error}`);
      }
      continue;
    }

    if (name === "schedule_reminder") {
      if (output?.ok) {
        const verb = output.replaced ? "Updated reminder for" : "Scheduled reminder for";
        applied.push(`${verb} ${formatAssignmentLabel(output.assignment) || output.key}`);
        if (output.deletedDuplicates) {
          info.push(`Removed ${output.deletedDuplicates} duplicate reminder(s).`);
        }
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "update_assignment_reminder") {
      if (output?.ok) {
        applied.push(`Updated reminder #${output.reminder?.id}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "delete_assignment_reminder") {
      if (output?.ok) {
        applied.push(`Deleted reminder #${output.id}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "refresh_schoology") {
      if (output?.ok) {
        applied.push(`Refreshed Schoology. Missing: ${output.missingCount}, Resolved: ${output.resolvedCount}.`);
        if (output.clearedManualCount > 0) {
          info.push(`Cleared ${output.clearedManualCount} manual status(es).`);
        }
        if (output.keptManual?.length) {
          info.push(`Kept ${output.keptManual.length} manual status(es) that may still be relevant.`);
        }
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "create_task") {
      if (output?.ok) {
        applied.push(`Created task #${output.id}: ${output.title}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "update_task_status") {
      if (output?.ok) {
        applied.push(`Task #${output.task?.id} -> ${output.task?.status}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "update_task") {
      if (output?.ok) {
        applied.push(`Updated task #${output.task?.id}: ${output.task?.title}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "delete_task") {
      if (output?.ok) {
        applied.push(`Deleted task #${output.id}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "add_assignment_note") {
      if (output?.ok) {
        applied.push(`Added note to ${formatAssignmentLabel(output.assignment) || output.key}`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "update_assignment_status") {
      if (output?.ok) {
        applied.push(`${formatAssignmentLabel(output.assignment)} -> ${output.status}`);
      } else if (output?.matches?.length) {
        needs.push(`Multiple matches for "${args.title || "assignment"}".`);
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "bulk_update_assignment_statuses") {
      const resultsList = output?.results || [];
      for (const entry of resultsList) {
        const res = entry.result;
        if (res?.ok) {
          applied.push(`${formatAssignmentLabel(res.assignment)} -> ${res.status}`);
        } else if (res?.matches?.length) {
          needs.push(`Multiple matches for "${entry.input?.title || "assignment"}".`);
        } else if (res?.error) {
          needs.push(res.error);
        }
      }
      continue;
    }

    if (name === "apply_numbered_statuses") {
      const resultsList = output?.results || [];
      for (const entry of resultsList) {
        const res = entry.result;
        if (res?.ok) {
          applied.push(`${formatAssignmentLabel(res.assignment || entry.assignment)} -> ${res.status}`);
        } else if (res?.error) {
          needs.push(res.error);
        }
      }
      continue;
    }
  }

  const lines = [];
  if (applied.length > 0) {
    lines.push("Updates applied:");
    applied.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
  }

  if (needs.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Needs clarification:");
    needs.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
  }

  if (info.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Info:");
    info.forEach((line, idx) => lines.push(`${idx + 1}. ${line}`));
  }

  if (db) {
    const pending = listAssignments(db, { status: "missing", includeIgnored: true, includePending: true })
      .filter((row) => row.statusCategory === "pending");
    if (pending.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Follow-up needed (waiting on teacher/grade):");
      pending.forEach((row, idx) => {
        const status = row.manualStatus || row.status || "Pending";
        const due = row.dueDate ? ` (Due ${row.dueDate})` : "";
        lines.push(`${idx + 1}. ${row.course} - ${row.title}${due} - ${status}`);
      });
    }
  }

  return lines.join("\n").trim();
}

function hasToolErrors(results = []) {
  return results.some((item) => {
    const output = item.output || {};
    if (output?.ok === false) return true;
    if (output?.error) return true;
    if (Array.isArray(output?.results)) {
      return output.results.some((entry) => entry?.result?.ok === false || entry?.result?.error);
    }
    return false;
  });
}

function applyManualStatusPolicy(rows) {
  const cleared = [];
  const kept = [];
  for (const row of rows) {
    const hasNotes = Number(row.notesCount || 0) > 0;
    if (hasNotes) {
      kept.push({ ...row, reason: "Has notes" });
      continue;
    }
    if (isIgnoredStatus(row.manualStatus)) {
      cleared.push(row);
      continue;
    }
    if (isPendingStatus(row.manualStatus)) {
      kept.push({ ...row, reason: "Pending status" });
      continue;
    }
    kept.push({ ...row, reason: "Custom status" });
  }
  return { cleared, kept };
}

async function runTool(db, call) {
  const args = parseArguments(call.arguments);
  switch (call.name) {
    case "list_assignments":
      return { ok: true, assignments: listAssignments(db, args) };
    case "update_assignment_status":
      return updateAssignmentStatus(db, args);
    case "bulk_update_assignment_statuses":
      return updateAssignmentStatuses(db, args.updates || []);
    case "apply_numbered_statuses":
      return applyNumberedStatuses(db, args);
    case "add_assignment_note":
      return addAssignmentNote(db, args);
    case "schedule_reminder":
      return scheduleReminder(db, args);
    case "list_assignment_reminders":
      return { ok: true, reminders: listReminders(db, args) };
    case "update_assignment_reminder":
      return updateReminder(db, args);
    case "delete_assignment_reminder":
      return deleteReminder(db, args);
    case "create_task":
      return createTask(db, args);
    case "list_tasks":
      return { ok: true, tasks: listTasks(db, args) };
    case "update_task_status":
      return updateTaskStatus(db, args);
    case "update_task":
      return updateTask(db, args);
    case "delete_task":
      return deleteTask(db, args);
    case "refresh_schoology": {
      try {
        const { state } = await runScrape();
        const since = state?.lastScrapeAt || new Date().toISOString();
        const resolved = listResolvedWithManualStatus(db, since);
        const { cleared, kept } = applyManualStatusPolicy(resolved);
        const clearResult = clearManualStatuses(db, cleared.map((row) => row.key));
        const missingCount = listAssignments(db, {
          status: "missing",
          includeIgnored: true,
          includePending: true,
        }).length;
        return {
          ok: true,
          missingCount,
          resolvedCount: resolved.length,
          clearedManualCount: clearResult.cleared || 0,
          keptManual: kept,
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
    case "open_bug_report":
      return await openBugReport(getConfig(), args);
    case "open_feature_request":
      return await openFeatureRequest(getConfig(), args);
    default:
      return { ok: false, error: `Unknown tool: ${call.name}` };
  }
}

async function maybeCompact(client, config, chatId, chatState, responseId) {
  const threshold = config.openai.compactAfterTurns;
  if (!threshold || chatState.turnCount < threshold) return responseId;
  if (typeof client.responses.compact !== "function") return responseId;

  try {
    const compacted = await client.responses.compact({
      previous_response_id: responseId,
    });
    if (compacted?.id) {
      return compacted.id;
    }
  } catch (err) {
    console.warn("Compaction failed:", err?.message || err);
  }

  return responseId;
}

function isInvalidPreviousResponse(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("previous_response_id") ||
    message.includes("response_id") ||
    message.includes("not found") ||
    message.includes("no tool output found")
  );
}

export async function runAgentMessage({ chatId, text, clientOverride }) {
  const config = getConfig();
  validateOpenAIConfig();

  const db = getDb(config);
  ensureDbSeeded(db, config.paths.statePath);

  const chatState = getChatState(db, chatId);
  const pendingAction = getPendingAction(db, chatId);
  const client = clientOverride || new OpenAI({ apiKey: config.openai.apiKey });

  const previousResponseId = chatState.lastResponseId || undefined;
  let activePending = pendingAction;
  let pendingDecision = null;
  if (pendingAction) {
    try {
      pendingDecision = await decidePendingAction(client, config, pendingAction, text, previousResponseId);
    } catch (err) {
      pendingDecision = "proceed";
    }
    if (pendingDecision === "cancel") {
      clearPendingAction(db, chatId);
      activePending = null;
    }
  }

  const planText = buildPlanInput(text, activePending);
  const allowedToolsOverride =
    activePending && pendingDecision === "proceed" ? [activePending.tool] : null;
  let plan;
  try {
    plan = await planAction(client, config, planText, previousResponseId, allowedToolsOverride);
  } catch (err) {
    if (previousResponseId && isInvalidPreviousResponse(err)) {
      resetChatState(db, chatId);
      plan = await planAction(client, config, planText, undefined, allowedToolsOverride);
    } else if (previousResponseId && isRetryableError(err)) {
      plan = await planAction(client, config, planText, undefined, allowedToolsOverride);
    } else {
      throw err;
    }
  }

  let calls = [];
  if (plan.action === "call_tool" && plan.tool) {
    calls = [{ tool: plan.tool, args: plan.args || {} }];
  } else if (plan.action === "call_tools" && Array.isArray(plan.calls)) {
    calls = plan.calls;
  }

  const executed = [];
  for (const call of calls) {
    const normalizedTool = normalizeToolName(call?.tool);
    if (!call || !normalizedTool) {
      executed.push({
        call: { name: call?.tool || "unknown", arguments: call?.args || {} },
        output: { ok: false, error: "Invalid or missing tool name." },
      });
      continue;
    }
    const pendingArgs =
      activePending && activePending.tool === normalizedTool ? activePending.args : null;
    const mergedArgs = mergePendingArgs(pendingArgs, call.args);
    const normalizedArgs = normalizeToolArgs(normalizedTool, mergedArgs);
    const output = await runTool(db, { name: normalizedTool, arguments: normalizedArgs });
    executed.push({ call: { name: normalizedTool, arguments: normalizedArgs }, output });
  }

  for (const item of executed) {
    const name = item.call?.name;
    const output = item.output || {};
    if (activePending && name === activePending.tool && output?.ok === true) {
      clearPendingAction(db, chatId);
      continue;
    }
    if (shouldStorePendingAction(name, output)) {
      const args = parseArguments(item.call?.arguments);
      const matches = Array.isArray(output?.matches) ? output.matches : null;
      setPendingAction(db, { chatId, tool: name, args, note: output?.error || "", matches });
    }
  }

  const toolResults = executed.map((item) => ({
    tool: item.call.name,
    args: item.call.arguments,
    output: item.output,
  }));
  let draftMessage = null;
  if (hasWriteTool(executed)) {
    const summaryDraft = formatUpdateSummary(executed, db);
    if (summaryDraft) draftMessage = summaryDraft;
  } else if (plan.action === "respond" || plan.action === "clarify") {
    draftMessage = plan.message;
  }
  const finalInput = buildFinalInput(text, draftMessage, toolResults);

  let response;
  try {
    response = await createResponseWithRetry(client, {
      model: config.openai.model,
      reasoning: { effort: config.openai.reasoningEffort },
      max_output_tokens: config.openai.maxOutputTokens,
      instructions: buildResponsePrompt(),
      input: finalInput,
      text: {
        format: {
          type: "json_object",
        },
      },
      tool_choice: "none",
      parallel_tool_calls: false,
      previous_response_id: previousResponseId,
    });
  } catch (err) {
    if (previousResponseId && isInvalidPreviousResponse(err)) {
      resetChatState(db, chatId);
      response = await createResponseWithRetry(client, {
        model: config.openai.model,
        reasoning: { effort: config.openai.reasoningEffort },
        max_output_tokens: config.openai.maxOutputTokens,
        instructions: buildResponsePrompt(),
        input: finalInput,
        text: {
          format: {
            type: "json_object",
          },
        },
        tool_choice: "none",
        parallel_tool_calls: false,
      });
    } else if (previousResponseId && isRetryableError(err)) {
      response = await createResponseWithRetry(client, {
        model: config.openai.model,
        reasoning: { effort: config.openai.reasoningEffort },
        max_output_tokens: config.openai.maxOutputTokens,
        instructions: buildResponsePrompt(),
        input: finalInput,
        text: {
          format: {
            type: "json_object",
          },
        },
        tool_choice: "none",
        parallel_tool_calls: false,
      });
    } else {
      throw err;
    }
  }

  const rawText = extractText(response).trim();
  const finalText = parseResponseMessage(rawText);
  const sanitized = sanitizeRepeatedText(finalText);
  const normalized = normalizeAscii(sanitized);
  updateChatState(db, chatId, response.id);

  const compactedId = await maybeCompact(client, config, chatId, getChatState(db, chatId), response.id);
  if (compactedId !== response.id) {
    updateChatCompaction(db, chatId, compactedId);
  }

  if (!normalized || isRepetitiveOutput(finalText) || isToolingLoop(finalText)) {
    const summary = formatUpdateSummary(executed, db);
    return normalizeAscii(summary || normalized || "Done.");
  }
  return normalized;
}
