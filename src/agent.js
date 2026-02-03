import "dotenv/config";
import OpenAI from "openai";
import { getConfig, validateOpenAIConfig } from "./config.js";
import {
  addAssignmentNote,
  ensureDbSeeded,
  getChatState,
  getDb,
  listAssignments,
  scheduleReminder,
  updateAssignmentStatus,
  updateChatCompaction,
  updateChatState,
} from "./db.js";

function buildSystemPrompt() {
  return [
    "You are a Schoology assistant.",
    "Use tools to fetch assignments, update statuses, add notes, and schedule reminders.",
    "If a request is ambiguous, ask a clarifying question.",
    "Never invent assignments or data.",
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

async function runTool(db, call) {
  const args = parseArguments(call.arguments);
  switch (call.name) {
    case "list_assignments":
      return { ok: true, assignments: listAssignments(db, args) };
    case "update_assignment_status":
      return updateAssignmentStatus(db, args);
    case "add_assignment_note":
      return addAssignmentNote(db, args);
    case "schedule_reminder":
      return scheduleReminder(db, args);
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

export async function runAgentMessage({ chatId, text }) {
  const config = getConfig();
  validateOpenAIConfig();

  const db = getDb(config);
  ensureDbSeeded(db, config.paths.statePath);

  const chatState = getChatState(db, chatId);
  const client = new OpenAI({ apiKey: config.openai.apiKey });

  const response = await client.responses.create({
    model: config.openai.model,
    reasoning: { effort: config.openai.reasoningEffort },
    max_output_tokens: config.openai.maxOutputTokens,
    instructions: buildSystemPrompt(),
    input: text,
    tools: toolDefinitions(),
    tool_choice: "auto",
    previous_response_id: chatState.lastResponseId || undefined,
  });

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

    currentResponse = await client.responses.create({
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
