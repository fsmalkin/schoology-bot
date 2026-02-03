import "dotenv/config";
import OpenAI from "openai";
import { getConfig, validateOpenAIConfig } from "./config.js";
import {
  addAssignmentNote,
  ensureDbSeeded,
  getChatState,
  getDb,
  listAssignments,
  applyNumberedStatuses,
  resetChatState,
  scheduleReminder,
  updateAssignmentStatus,
  updateAssignmentStatuses,
  updateChatCompaction,
  updateChatState,
} from "./db.js";
import { openBugReport, openFeatureRequest } from "./bugs.js";
import { statusGuideText } from "./statuses.js";

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
    "If the user suggests improvements or feature ideas, ask if they want you to log a feature request.",
    "Only open bug reports when the user explicitly asks to file a bug or report an error.",
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
        },
        required: ["remindAt"],
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

export async function runAgentMessage({ chatId, text }) {
  const config = getConfig();
  validateOpenAIConfig();

  const db = getDb(config);
  ensureDbSeeded(db, config.paths.statePath);

  const chatState = getChatState(db, chatId);
  const client = new OpenAI({ apiKey: config.openai.apiKey });

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
    for (const call of toolCalls) {
      const output = await runTool(db, call);
      toolOutputs.push({
        type: call.outputType,
        call_id: call.id,
        output: JSON.stringify(output),
      });
    }

    currentResponse = await createResponseWithRetry(client, {
      model: config.openai.model,
      reasoning: { effort: config.openai.reasoningEffort },
      max_output_tokens: config.openai.maxOutputTokens,
      input: toolOutputs,
      previous_response_id: currentResponse.id,
    });
  }

  const finalText = extractText(currentResponse).trim();
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

  return finalText || "Done.";
}
