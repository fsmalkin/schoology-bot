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
import { statusGuideText } from "./statuses.js";
import { runToolByName, TOOL_NAMES } from "./tool_runner.js";
import { isRepetitiveOutput, isToolingLoop, normalizeAscii, sanitizeRepeatedText } from "./text_utils.js";
import { getBootstrapContext } from "./bootstrap.js";
import { nowIso } from "./time.js";

function buildResponsePrompt() {
  return [
    "You are a Schoology assistant.",
    "Use the provided tool results as the source of truth.",
    "Respect tool capabilities listed in Bootstrap Context; if something is unsupported (ex: recurring reminders), say so and offer the closest supported alternative.",
    "Never claim updates unless tool results confirm success.",
    "If tool results include errors, explain them briefly and ask for the missing detail.",
    "When talking about tasks or assignment reminders, use the term 'Reminders' and combine them unless the user asks for a specific type.",
    "If a note implies a follow-up action, ask if the user wants a reminder created.",
    "Manual statuses, assignment notes, and reminders are stored locally (not in Schoology) and can be updated immediately via tools.",
    "If a pending action is confirmed, do not ask for confirmation again. Execute the queued update and report the result.",
    `Manual status codes: ${statusGuideText()}.`,
    "Default reporting buckets: Actionable, Pending, Ignored. Hide Ignored by default unless asked.",
    "When confirming status updates, include a short list of items waiting on teacher/grade (No grade put in yet, Waiting on teacher).",
    "If the user suggests improvements or feature ideas, ask if they want you to log a feature request.",
    "Reply with plain text.",
    "Use simple lists (use '-' for bullets, '1.' for numbering).",
    "Do not use HTML tags or Markdown code fences.",
    "Do not mention tool calls or function names.",
    "If a reminder time is slightly ambiguous, make a best-guess schedule and offer to adjust. Ask for clarification only when no reasonable guess is possible.",
    "Times are America/New_York by default. If tool results include remindAtLabel or remindAtLocal, use those instead of raw ISO/UTC.",
    "Keep responses concise and action-oriented.",
    getBootstrapContext() ? `\\nBootstrap Context:\\n${getBootstrapContext()}` : "",
  ].join(" ");
}

function hasAssignmentSelector(args) {
  if (!args || typeof args !== "object") return false;
  const key = args.key ? String(args.key).trim() : "";
  const title = args.title ? String(args.title).trim() : "";
  // Course alone is not enough to target a single assignment; require key or title.
  return Boolean(key || title);
}

function isInvalidPendingAction(pending) {
  if (!pending || typeof pending !== "object") return true;
  if (!pending.tool || typeof pending.tool !== "string") return true;
  const args = pending.args && typeof pending.args === "object" ? pending.args : null;
  if (!args) return true;

  // If we stored a pending write without any assignment selector, the system will loop forever on "confirm/go".
  const assignmentWriteTools = new Set([
    "add_assignment_note",
    "update_assignment_status",
    "schedule_reminder",
  ]);
  if (assignmentWriteTools.has(pending.tool) && !hasAssignmentSelector(args)) return true;

  return false;
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
          maximum: 1000,
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

function extractFunctionCalls(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .filter((item) => item && item.type === "function_call")
    .map((item) => ({
      name: item?.name || null,
      arguments: item?.arguments || null,
      callId: item?.call_id || null,
    }))
    .filter((call) => Boolean(call.name));
}

function parseToolCallArgs(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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

function isInvalidPreviousResponseIdError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("previous_response_id") ||
    message.includes("previous response") ||
    message.includes("no tool output found") ||
    (message.includes("response_id") && message.includes("not found"))
  );
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
      if (payload?.previous_response_id && isInvalidPreviousResponseIdError(err)) {
        const next = { ...payload };
        delete next.previous_response_id;
        payload = next;
        continue;
      }
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
    "For write tools (notes/status/reminders/tasks), args must be the actual content to store (short and literal), not a user-facing explanation.",
    "For assignment updates, include enough identification to target the assignment: at least title (and course if known), or key if provided.",
    "If exactly one tool is needed, use action=call_tool with tool + args.",
    "If multiple tools are needed, use action=call_tools with calls in order.",
    "Always set tool to the primary tool (for call_tools, use the first tool in calls).",
    "For args, provide a JSON string like \"{}\" or \"{\\\"status\\\":\\\"missing\\\"}\".",
    `Allowed tools: ${allowedTools.join(", ")}.`,
    "Examples:",
    "User: refresh my assignments -> {\"action\":\"call_tool\",\"tool\":\"refresh_schoology\",\"args\":\"{}\",\"calls\":null}",
    "User: refresh and list missing -> {\"action\":\"call_tools\",\"tool\":\"refresh_schoology\",\"args\":\"{}\",\"calls\":[{\"tool\":\"refresh_schoology\",\"args\":\"{}\"},{\"tool\":\"list_assignments\",\"args\":\"{\\\"status\\\":\\\"missing\\\",\\\"includePending\\\":true,\\\"includeIgnored\\\":false,\\\"bucketed\\\":true}\"}]}",
    "User: what are my missing assignments -> {\"action\":\"call_tool\",\"tool\":\"list_assignments\",\"args\":\"{\\\"status\\\":\\\"missing\\\",\\\"includePending\\\":true,\\\"includeIgnored\\\":false,\\\"bucketed\\\":true}\",\"calls\":null}",
    "User: add note to Latin Quiz 1 -> {\"action\":\"call_tool\",\"tool\":\"add_assignment_note\",\"args\":\"{\\\"title\\\":\\\"Quiz 1\\\",\\\"course\\\":\\\"Latin\\\",\\\"note\\\":\\\"Submitted. Waiting for grade.\\\"}\",\"calls\":null}",
    "User: mark Latin Quiz 1 as Waiting on teacher -> {\"action\":\"call_tool\",\"tool\":\"update_assignment_status\",\"args\":\"{\\\"title\\\":\\\"Quiz 1\\\",\\\"course\\\":\\\"Latin\\\",\\\"status\\\":\\\"E\\\"}\",\"calls\":null}",
    "User: remind me Thu 7:15am to follow up on Algebra Homework 1 -> {\"action\":\"call_tool\",\"tool\":\"schedule_reminder\",\"args\":\"{\\\"title\\\":\\\"Homework 1\\\",\\\"course\\\":\\\"Algebra\\\",\\\"remindAt\\\":\\\"Thu 7:15am\\\",\\\"message\\\":\\\"Follow up with teacher\\\"}\",\"calls\":null}",
    "User: add note + set status + schedule reminder -> {\"action\":\"call_tools\",\"tool\":\"add_assignment_note\",\"args\":\"{\\\"title\\\":\\\"January 30th-Tpc01C\\\",\\\"course\\\":\\\"Latin\\\",\\\"note\\\":\\\"Submitted. Waiting for grade.\\\"}\",\"calls\":[{\"tool\":\"add_assignment_note\",\"args\":\"{\\\"title\\\":\\\"January 30th-Tpc01C\\\",\\\"course\\\":\\\"Latin\\\",\\\"note\\\":\\\"Submitted. Waiting for grade.\\\"}\"},{\"tool\":\"update_assignment_status\",\"args\":\"{\\\"title\\\":\\\"January 30th-Tpc01C\\\",\\\"course\\\":\\\"Latin\\\",\\\"status\\\":\\\"E\\\"}\"},{\"tool\":\"schedule_reminder\",\"args\":\"{\\\"title\\\":\\\"U5 Compound Interest/Intervals\\\",\\\"course\\\":\\\"Algebra\\\",\\\"remindAt\\\":\\\"Thu 7:15am\\\",\\\"message\\\":\\\"Follow up on math make-up after school plan\\\"}\"}]}",
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
    "If the user asked for any write actions (notes/status/reminders/tasks), you MUST add the corresponding write tool calls until the request is fully satisfied.",
    "Do not stop at a read-only tool (like list_assignments) if the user clearly requested updates.",
    "If you do not have an assignment key, use title (and course if available). The tools can match by title/course and will ask for clarification if ambiguous.",
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
      // Tool planning is where we most need good intent understanding. Use the configured effort.
      reasoning: { effort: config.openai.reasoningEffort || "low" },
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
    // Keep the same effort as the planner to avoid missing write actions in multi-step requests.
    reasoning: { effort: config.openai.reasoningEffort || "low" },
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

function buildPlanInput(text, pending, bootstrap) {
  const base = bootstrap ? `${bootstrap}\\n\\nUser message:\\n${text}` : text;
  if (!pending) return base;
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
    "Treat explicit confirmations like 'go', 'confirmed', or 'yes' as proceed.",
  ].join(" ");
}

function normalizeConfirmText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
}

function isExplicitConfirm(text) {
  const value = normalizeConfirmText(text);
  if (!value) return false;
  if (value.length > 32) return false;
  const confirms = new Set([
    "go",
    "confirmed",
    "confirm",
    "yes",
    "y",
    "ok",
    "okay",
    "do it",
    "proceed",
    "sounds good",
    "please do",
  ]);
  return confirms.has(value);
}

function isExplicitCancel(text) {
  const value = normalizeConfirmText(text);
  if (!value) return false;
  const cancels = new Set(["cancel", "never mind", "nevermind", "stop", "no"]);
  return cancels.has(value);
}

async function decidePendingAction(client, config, pending, text, previousResponseId) {
  const schema = buildPendingDecisionSchema();
  const input = buildPlanInput(text, pending, getBootstrapContext());
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

function buildBugDraftSchema() {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      labels: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["title", "body", "labels"],
    additionalProperties: false,
  };
}

function buildBugDraftInstructions(kind) {
  const label = kind === "feature" ? "feature request" : "bug report";
  return [
    "Return JSON only. No extra text.",
    `Draft a concise ${label}.`,
    "Use conversation context if available.",
    "Title: short, specific.",
    "Body: include Summary, Steps, Expected, Actual.",
    "Keep body under 12 lines.",
  ].join(" ");
}

async function buildBugDraft(client, config, text, provided, kind, previousResponseId) {
  const schema = buildBugDraftSchema();
  const input = [
    "User request:",
    text,
    "",
    "Provided fields (if any):",
    JSON.stringify(provided || {}, null, 2),
  ].join("\n");

  const response = await createResponseWithRetry(client, {
    model: config.openai.model,
    reasoning: { effort: "low" },
    max_output_tokens: 400,
    instructions: buildBugDraftInstructions(kind),
    input,
    text: {
      format: {
        type: "json_schema",
        name: "bug_draft",
        strict: true,
        schema,
      },
    },
    tool_choice: "none",
    parallel_tool_calls: false,
    previous_response_id: previousResponseId || undefined,
  });

  const raw = extractText(response);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }

  const fallbackTitle = `${kind === "feature" ? "Feature request" : "Bug report"} ${nowIso()}`;
  const draftTitle = String(parsed?.title || "").trim() || fallbackTitle;
  const draftBody = String(parsed?.body || "").trim() || String(text || "").trim();
  const labels = Array.isArray(parsed?.labels) ? parsed.labels : [];

  return { title: draftTitle, body: draftBody, labels };
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
  if (message.includes("reminder time is required")) return true;
  if (message.includes("reminder time is invalid")) return true;
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
        if (output.remindAtLabel) {
          info.push(`Reminder time: ${output.remindAtLabel}.`);
        }
        if (output.assumption) {
          info.push(
            `I picked a best-guess time (${output.remindAtLabel || "see reminder time"}). Say "change to ..." if you want a different time.`
          );
        }
      } else if (output?.error) {
        needs.push(output.error);
      }
      continue;
    }

    if (name === "update_assignment_reminder") {
      if (output?.ok) {
        applied.push(`Updated reminder #${output.reminder?.id}`);
        if (output.reminder?.remindAtLabel) {
          info.push(`Reminder time: ${output.reminder.remindAtLabel}.`);
        }
        if (output.assumption) {
          info.push(
            `I picked a best-guess time (${output.reminder?.remindAtLabel || "see reminder time"}). Say "change to ..." if you want a different time.`
          );
        }
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
        const actionable = Number(output.actionableCount || 0);
        const pending = Number(output.pendingCount || 0);
        const ignored = Number(output.ignoredCount || 0);
        const parts = [];
        if (actionable > 0) {
          parts.push(`${actionable} still need action`);
        } else {
          parts.push("no items need action");
        }
        if (pending > 0) {
          parts.push(`${pending} waiting on a grade`);
        }
        if (ignored > 0) {
          parts.push(`${ignored} archived`);
        }
        applied.push(`Refresh complete. ${parts.join("; ")}.`);
        if (Array.isArray(output.ignoredReasons) && output.ignoredReasons.length > 0) {
          info.push(`Archived because: ${output.ignoredReasons.join(", ")}.`);
        }
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
        if (output.remindAtLabel) {
          info.push(`Reminder time: ${output.remindAtLabel}.`);
        }
        if (output.assumption) {
          info.push(
            `I picked a best-guess time (${output.remindAtLabel || "see reminder time"}). Say "change to ..." if you want a different time.`
          );
        }
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
        if (output.task?.remindAtLabel) {
          info.push(`Reminder time: ${output.task.remindAtLabel}.`);
        }
        if (output.assumption) {
          info.push(
            `I picked a best-guess time (${output.task?.remindAtLabel || "see reminder time"}). Say "change to ..." if you want a different time.`
          );
        }
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
  if (activePending && isInvalidPendingAction(activePending)) {
    // Prevent infinite "confirm/go" loops caused by malformed pending actions.
    clearPendingAction(db, chatId);
    activePending = null;
  }
  let pendingDecision = null;
  if (activePending) {
    try {
      if (isExplicitCancel(text)) {
        pendingDecision = "cancel";
      } else if (isExplicitConfirm(text)) {
        pendingDecision = "proceed";
      } else {
        pendingDecision = await decidePendingAction(
          client,
          config,
          activePending,
          text,
          previousResponseId
        );
      }
    } catch (err) {
      pendingDecision = "proceed";
    }
    if (pendingDecision === "cancel") {
      clearPendingAction(db, chatId);
      activePending = null;
    }
  }

  const planText = buildPlanInput(text, activePending, getBootstrapContext());
  const allowedToolsOverride =
    activePending && pendingDecision === "proceed" ? [activePending.tool] : null;
  const allowedToolNames =
    Array.isArray(allowedToolsOverride) && allowedToolsOverride.length > 0
      ? allowedToolsOverride
      : TOOL_NAMES;
  const tools = toolDefinitions().filter((tool) => allowedToolNames.includes(tool.name));
  const forcedToolName =
    Array.isArray(allowedToolsOverride) && allowedToolsOverride.length === 1
      ? allowedToolsOverride[0]
      : null;
  const toolChoice = forcedToolName ? { type: "function", name: forcedToolName } : "auto";

  const toolLoopInstructions = [
    buildResponsePrompt(),
    "Tools are available. Use tools to read/update the local DB.",
    "Do not claim you cannot apply updates. Notes/statuses/reminders are local and always writable.",
    "If a tool output indicates missing details or multiple matches, ask a clarifying question and stop calling tools until the user responds.",
  ].join("\n");

  const executed = [];
  let response = null;
  // Carry conversation state across turns so the model can resolve references like "that one" or "Step 1".
  // We still update loopPrev inside the tool loop so function_call_output attaches to the correct response.
  let loopPrev = previousResponseId || undefined;
  let nextInput = planText;
  let finalText = "";

  for (let step = 0; step < 6; step += 1) {
    response = await createResponseWithRetry(client, {
      model: config.openai.model,
      reasoning: { effort: config.openai.reasoningEffort },
      max_output_tokens: config.openai.maxOutputTokens,
      instructions: toolLoopInstructions,
      input: nextInput,
      tools,
      tool_choice: toolChoice,
      parallel_tool_calls: false,
      previous_response_id: loopPrev || undefined,
    });

    const functionCalls = extractFunctionCalls(response);
    if (!functionCalls || functionCalls.length === 0) {
      finalText = parseResponseMessage(extractText(response).trim());
      break;
    }

    const outputs = [];
    for (const call of functionCalls) {
      const normalizedTool = normalizeToolName(call?.name, allowedToolNames);
      if (!normalizedTool) {
        executed.push({
          call: { name: call?.name || "unknown", arguments: {} },
          output: { ok: false, error: "Invalid or missing tool name." },
        });
        continue;
      }

      let callArgs = parseToolCallArgs(call.arguments);
      if (normalizedTool === "open_bug_report" || normalizedTool === "open_feature_request") {
        const kind = normalizedTool === "open_feature_request" ? "feature" : "bug";
        const draft = await buildBugDraft(client, config, text, callArgs, kind, loopPrev);
        callArgs = { title: draft.title, body: draft.body, labels: draft.labels };
      }

      const pendingArgs =
        activePending && activePending.tool === normalizedTool ? activePending.args : null;
      const mergedArgs = mergePendingArgs(pendingArgs, callArgs);
      const normalizedArgs = normalizeToolArgs(normalizedTool, mergedArgs);
      const output = await runToolByName(db, normalizedTool, normalizedArgs);
      executed.push({ call: { name: normalizedTool, arguments: normalizedArgs }, output });

      if (call.callId) {
        outputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify(output),
        });
      }

      if (activePending && normalizedTool === activePending.tool && output?.ok === true) {
        clearPendingAction(db, chatId);
        activePending = null;
      }

      if (shouldStorePendingAction(normalizedTool, output)) {
        const args = parseArguments(normalizedArgs);
        const matches = Array.isArray(output?.matches) ? output.matches : null;
        setPendingAction(db, {
          chatId,
          tool: normalizedTool,
          args,
          note: output?.error || "",
          matches,
        });
        activePending = getPendingAction(db, chatId);
      }
    }

    loopPrev = response?.id || loopPrev;
    nextInput = outputs;
  }

  if (!finalText) {
    finalText = formatUpdateSummary(executed, db) || "Done.";
  }
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
