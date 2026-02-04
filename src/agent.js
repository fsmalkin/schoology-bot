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
  updateChatCompaction,
  updateChatState,
} from "./db.js";
import { openBugReport, openFeatureRequest } from "./bugs.js";
import { statusGuideText, isIgnoredStatus, isPendingStatus } from "./statuses.js";
import { isRepetitiveOutput, sanitizeRepeatedText } from "./text_utils.js";
import { runScrape } from "./tasks.js";

function buildSystemPrompt() {
  return [
    "You are a Schoology assistant.",
    "Use tools to fetch assignments, update statuses, add notes, and schedule reminders.",
    "If a request is ambiguous, ask a clarifying question.",
    "Never invent assignments or data.",
    "Do not claim updates unless tool results confirm success.",
    "If the user provides numbered updates, use apply_numbered_statuses.",
    "If the user provides explicit titles and statuses, use bulk_update_assignment_statuses.",
    `Manual status codes: ${statusGuideText()}.`,
    "Default reporting buckets: Actionable, Pending, Ignored. Hide Ignored by default unless asked.",
    "When confirming status updates, include a short list of items waiting on teacher/grade (No grade put in yet, Waiting on teacher).",
    "You can create, list, update, or delete personal tasks with reminders (not tied to Schoology).",
    "You can run a fresh Schoology scrape on demand if the user asks to check again.",
    "When refreshing, only auto-clear ignored manual statuses (A/B/C) for resolved items with no notes; keep pending and custom statuses.",
    "If the user suggests improvements or feature ideas, ask if they want you to log a feature request.",
    "Only open bug reports when the user explicitly asks to file a bug or report an error.",
    "Respond in Telegram-friendly HTML (use <b>, <code>, <pre> tags; avoid Markdown).",
    "Keep responses concise and action-oriented.",
  ].join(" ");
}

function toolDefinitions() {
  return [
    {
      type: "function",
      name: "list_assignments",
      description: "List assignments with optional filters.",
      parameters: {
        type: "object",
        properties: {
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
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "update_assignment_status",
      description: "Set a manual status for an assignment.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Assignment key." },
          title: { type: "string", description: "Assignment title to match." },
          course: { type: "string", description: "Course name to match." },
          status: { type: "string", description: "New status text." },
        },
        required: ["status"],
      },
    },
    {
      type: "function",
      name: "bulk_update_assignment_statuses",
      description: "Set manual statuses for multiple assignments at once.",
      parameters: {
        type: "object",
        properties: {
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
              required: ["status"],
            },
          },
        },
        required: ["updates"],
      },
    },
    {
      type: "function",
      name: "apply_numbered_statuses",
      description: "Apply statuses by index using the current missing list ordering.",
      parameters: {
        type: "object",
        properties: {
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
            },
          },
        },
        required: ["statusByIndex"],
      },
    },
    {
      type: "function",
      name: "add_assignment_note",
      description: "Add a note to an assignment.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Assignment key." },
          title: { type: "string", description: "Assignment title to match." },
          course: { type: "string", description: "Course name to match." },
          note: { type: "string", description: "Note text." },
        },
        required: ["note"],
      },
    },
    {
      type: "function",
      name: "schedule_reminder",
      description: "Schedule a reminder for an assignment.",
      parameters: {
        type: "object",
        properties: {
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
        required: ["remindAt"],
      },
    },
    {
      type: "function",
      name: "list_assignment_reminders",
      description: "List reminders for an assignment.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Assignment key." },
          status: { type: "string", enum: ["pending", "sent", "all"] },
        },
        required: ["key"],
      },
    },
    {
      type: "function",
      name: "update_assignment_reminder",
      description: "Update a reminder time or message.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Reminder id." },
          remindAt: { type: "string", description: "Reminder time in ISO-8601 format." },
          message: { type: "string", description: "Reminder message." },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "delete_assignment_reminder",
      description: "Delete a reminder.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Reminder id." },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "refresh_schoology",
      description: "Run a fresh Schoology scrape and reconcile manual statuses using the safe policy.",
      parameters: {
        type: "object",
        properties: {
          notes: { type: "string", description: "Optional reason or note for audit." },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "create_task",
      description: "Create a personal task with a reminder.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title." },
          remindAt: { type: "string", description: "Reminder time in ISO-8601 format." },
          message: { type: "string", description: "Optional reminder note." },
        },
        required: ["title", "remindAt"],
      },
    },
    {
      type: "function",
      name: "list_tasks",
      description: "List tasks with optional filters.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "done", "all"],
            description: "Filter by status.",
          },
          start: { type: "string", description: "ISO start datetime filter." },
          end: { type: "string", description: "ISO end datetime filter." },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "update_task_status",
      description: "Mark a task as done or pending.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Task id." },
          status: { type: "string", description: "done or pending." },
        },
        required: ["id", "status"],
      },
    },
    {
      type: "function",
      name: "update_task",
      description: "Update a task title, reminder time, or note.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Task id." },
          title: { type: "string", description: "Task title." },
          remindAt: { type: "string", description: "Reminder time in ISO-8601 format." },
          message: { type: "string", description: "Optional reminder note." },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "delete_task",
      description: "Delete a task.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Task id." },
        },
        required: ["id"],
      },
    },
    {
      type: "function",
      name: "open_bug_report",
      description: "Log a bug locally and optionally open a GitHub issue.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short bug title." },
          body: { type: "string", description: "Bug details and steps to reproduce." },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional GitHub labels.",
          },
        },
        required: ["title", "body"],
      },
    },
    {
      type: "function",
      name: "open_feature_request",
      description: "Log a feature request locally and optionally open a GitHub issue.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short request title." },
          body: { type: "string", description: "Request details and desired outcome." },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional GitHub labels.",
          },
        },
        required: ["title", "body"],
      },
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

function extractToolCalls(response) {
  const output = response?.output;
  if (!Array.isArray(output)) return [];
  return output
    .map((item) => {
      if (!item) return null;
      if (!["tool_call", "function_call", "custom_tool_call"].includes(item.type)) return null;
      const name = item.name || item.function?.name;
      const args = item.arguments || item.function?.arguments || item.input;
      if (!name) return null;
      const callId = item.call_id || item.callId || item.id;
      const outputType = item.type === "custom_tool_call" ? "custom_tool_call_output" : "function_call_output";
      return { id: callId, name, arguments: args, outputType };
    })
    .filter(Boolean);
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

const DIRECT_TOOL_NAMES = new Set([
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "apply_numbered_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "create_task",
  "update_task_status",
  "update_task",
  "delete_task",
  "refresh_schoology",
  "open_bug_report",
  "open_feature_request",
]);

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
  return message.includes("previous_response_id") || message.includes("response_id") || message.includes("not found");
}

export async function runAgentMessage({ chatId, text, clientOverride }) {
  const config = getConfig();
  validateOpenAIConfig();

  const db = getDb(config);
  ensureDbSeeded(db, config.paths.statePath);

  const chatState = getChatState(db, chatId);
  const client = clientOverride || new OpenAI({ apiKey: config.openai.apiKey });

  const basePayload = {
    model: config.openai.model,
    reasoning: { effort: config.openai.reasoningEffort },
    max_output_tokens: config.openai.maxOutputTokens,
    instructions: buildSystemPrompt(),
    input: text,
    tools: toolDefinitions(),
    tool_choice: "auto",
  };

  let response;
  try {
    response = await createResponseWithRetry(client, {
      ...basePayload,
      previous_response_id: chatState.lastResponseId || undefined,
    });
  } catch (err) {
    if (chatState.lastResponseId && isInvalidPreviousResponse(err)) {
      resetChatState(db, chatId);
      response = await createResponseWithRetry(client, basePayload);
    } else if (chatState.lastResponseId && isRetryableError(err)) {
      // Fallback: retry once without prior context if the server errors out.
      response = await createResponseWithRetry(client, basePayload);
    } else {
      throw err;
    }
  }

  let currentResponse = response;
  while (true) {
    const toolCalls = extractToolCalls(currentResponse);
    if (toolCalls.length === 0) break;

    const toolOutputs = [];
    const executed = [];
    for (const call of toolCalls) {
      const output = await runTool(db, call);
      executed.push({ call, output });
      toolOutputs.push({
        type: call.outputType,
        call_id: call.id,
        output: JSON.stringify(output),
      });
    }

    const directOnly = toolCalls.every((call) => DIRECT_TOOL_NAMES.has(call.name));

    currentResponse = await createResponseWithRetry(client, {
      model: config.openai.model,
      reasoning: { effort: config.openai.reasoningEffort },
      max_output_tokens: config.openai.maxOutputTokens,
      input: toolOutputs,
      previous_response_id: currentResponse.id,
    });

    if (directOnly) {
      const summary = formatUpdateSummary(executed, db);
      const candidate = sanitizeRepeatedText(extractText(currentResponse).trim());
      updateChatState(db, chatId, currentResponse.id);
      if (!candidate || isRepetitiveOutput(candidate)) {
        return summary || "Done.";
      }
      return candidate;
    }
  }

  const finalText = extractText(currentResponse).trim();
  const sanitized = sanitizeRepeatedText(finalText);
  updateChatState(db, chatId, currentResponse.id);

  const compactedId = await maybeCompact(
    client,
    config,
    chatId,
    getChatState(db, chatId),
    currentResponse.id
  );
  if (compactedId !== currentResponse.id) {
    updateChatCompaction(db, chatId, compactedId);
  }

  if (!sanitized || isRepetitiveOutput(finalText)) {
    return sanitized || "Done.";
  }
  return sanitized;
}
