import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findLatestArtifactDir(baseDir) {
  if (!fs.existsSync(baseDir)) return null;
  const entries = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) return null;
  return path.join(baseDir, entries[entries.length - 1]);
}

function extractText(response) {
  if (response?.output_text) return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .map((item) => {
      if (!item) return "";
      if (item.type === "output_text" && item.text) return item.text;
      if (item.type === "message" && Array.isArray(item.content)) {
        return item.content.map((part) => (part?.text ? part.text : "")).join("");
      }
      return "";
    })
    .join("");
}

function compactStoryEvidence(story) {
  const pruneOutput = (output) => {
    if (!output || typeof output !== "object") return {};
    return {
      ok: output.ok === true,
      error: output.error || "",
      id: output.id || output.reminderId || output?.task?.id || output?.reminder?.id || null,
      recurrenceKind:
        output.recurrenceKind || output?.task?.recurrenceKind || output?.reminder?.recurrenceKind || null,
      recurrenceLabel:
        output.recurrenceLabel || output?.task?.recurrenceLabel || output?.reminder?.recurrenceLabel || null,
      remindAtLabel:
        output.remindAtLabel || output?.task?.remindAtLabel || output?.reminder?.remindAtLabel || null,
      assumptions: Array.isArray(output.assumptions) ? output.assumptions : [],
      warnings: Array.isArray(output.warnings) ? output.warnings : [],
      sentCount: Number.isFinite(output.count) ? output.count : null,
      assignmentCount: Array.isArray(output.assignments) ? output.assignments.length : null,
      assignments: Array.isArray(output.assignments)
        ? output.assignments.slice(0, 5).map((assignment) => ({
            title: assignment.title || "",
            effectiveStatus: assignment.effectiveStatus || "",
            statusCategory: assignment.statusCategory || "",
          }))
        : [],
    };
  };

  const beforeTasks = Array.isArray(story?.snapshots?.before?.tasks)
    ? story.snapshots.before.tasks
    : Array.isArray(story?.snapshots?.tasks)
    ? story.snapshots.tasks
    : [];
  const beforeReminders = Array.isArray(story?.snapshots?.before?.reminders)
    ? story.snapshots.before.reminders
    : Array.isArray(story?.snapshots?.reminders)
    ? story.snapshots.reminders
    : [];
  const afterTasks = Array.isArray(story?.snapshots?.after?.tasks) ? story.snapshots.after.tasks : [];
  const afterReminders = Array.isArray(story?.snapshots?.after?.reminders)
    ? story.snapshots.after.reminders
    : [];

  return {
    id: story.id,
    title: story.title,
    required: story.required === true,
    judgeTarget: story.judgeTarget,
    prompts: story.prompts || [],
    checks: story.checks || [],
    derivedEvidence: story?.evidence || null,
    turns: (story.turns || []).map((turn) => ({
      turn: turn.turn,
      user: turn.user,
      assistant: turn.assistant,
      executed: (turn.executed || []).map((entry) => ({
        tool: entry?.call?.name || "",
        args: entry?.call?.arguments || {},
        output: pruneOutput(entry?.output || {}),
      })),
    })),
    snapshots: {
      beforeTasks: beforeTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        remindAt: task.remindAt,
        recurrenceKind: task.recurrenceKind,
        recurrenceTz: task.recurrenceTz,
        rollCount: task.rollCount,
      })),
      afterTasks: afterTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        remindAt: task.remindAt,
        recurrenceKind: task.recurrenceKind,
        recurrenceTz: task.recurrenceTz,
        rollCount: task.rollCount,
      })),
      beforeReminders: beforeReminders.map((reminder) => ({
        id: reminder.id,
        remindAt: reminder.remindAt,
        status: reminder.status,
        recurrenceKind: reminder.recurrenceKind,
      })),
      afterReminders: afterReminders.map((reminder) => ({
        id: reminder.id,
        remindAt: reminder.remindAt,
        status: reminder.status,
        recurrenceKind: reminder.recurrenceKind,
      })),
    },
  };
}

async function main() {
  const judgeModel = "gpt-5.2";
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for judge run.");
  }

  const explicitPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const artifactDir =
    explicitPath || findLatestArtifactDir(path.join(repoRoot, "artifacts", "agentic-story-suite"));
  if (!artifactDir || !fs.existsSync(artifactDir)) {
    throw new Error("No story suite artifact directory found.");
  }

  const manifestPath = path.join(artifactDir, "story-suite-manifest.json");
  const suitePath = path.join(artifactDir, "story-suite-full.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(suitePath)) {
    throw new Error(`Missing story suite files in ${artifactDir}`);
  }

  const manifest = readJson(manifestPath);
  const stories = readJson(suitePath);

  const judgeInput = {
    generatedAt: new Date().toISOString(),
    rubric: {
      releaseCriteria: [
        "General recurring ask with missing time should be created with explicit assumptions and correction path.",
        "Frequency cues should infer recurrence without requiring the word recurring.",
        "Non-frequency follow-up reminder should remain one-time.",
        "Conversational correction should update cadence/time in one step.",
        "Stop/cancel should end recurring reminders.",
        "Unsupported cadence should use weekly fallback with explicit evidence.",
        "DST weekly recurrence should preserve local wall-clock time.",
        "One-time reminders should preserve existing rollover behavior.",
        "Submitted-but-ungraded assignment questions should use the submitted_awaiting_grade filter and return icon-derived rows.",
      ],
      verdictRule: "Fail required story on any material miss or missing evidence.",
    },
    stories: stories.map((story) => compactStoryEvidence(story)),
  };

  const judgeInputPath = path.join(artifactDir, "judge-input.json");
  fs.writeFileSync(judgeInputPath, `${JSON.stringify(judgeInput, null, 2)}\n`, "utf8");

  const schema = {
    type: "object",
    properties: {
      model: { type: "string" },
      overall: { type: "string", enum: ["pass", "fail"] },
      summary: { type: "string" },
      stories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            required: { type: "boolean" },
            verdict: { type: "string", enum: ["pass", "fail"] },
            score: { type: "number" },
            evidence: { type: "array", items: { type: "string" }, maxItems: 2 },
            gaps: { type: "array", items: { type: "string" }, maxItems: 3 },
          },
          required: ["id", "title", "required", "verdict", "score", "evidence", "gaps"],
          additionalProperties: false,
        },
      },
      requiredFailures: { type: "array", items: { type: "string" } },
    },
    required: ["model", "overall", "summary", "stories", "requiredFailures"],
    additionalProperties: false,
  };

  const instructions = [
    "You are an acceptance judge for Schoology Bot UAT stories.",
    "Return JSON only and follow the schema exactly.",
    "Evaluate each story against its judgeTarget and rubric using only provided evidence.",
    "Treat turns, checks, derivedEvidence, and snapshots as valid evidence sources.",
    "For DST and rollover stories, derivedEvidence and snapshot deltas are deterministic post-check evidence.",
    "Evidence snippets must cite concrete values from the provided fields and be concise.",
    "Keep each evidence/gap item to one short sentence.",
    "Set verdict=fail when evidence is missing or behavior is materially wrong.",
    "Set requiredFailures to IDs of required stories that fail.",
  ].join(" ");

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: judgeModel,
    reasoning: { effort: "high" },
    max_output_tokens: 3200,
    instructions,
    input: [
      "Judge rubric and story evidence (JSON):",
      JSON.stringify(judgeInput),
    ].join("\n\n"),
    text: {
      format: {
        type: "json_schema",
        name: "agentic_story_judge",
        strict: true,
        schema,
      },
    },
    tool_choice: "none",
    parallel_tool_calls: false,
  });

  const raw = extractText(response).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Judge output was not valid JSON: ${raw}`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    artifactDir,
    runPolicy: "single-pass-gpt-5.2",
    responseId: response?.id || null,
    ...parsed,
    modelReportedByJudge: parsed?.model || null,
    model: response?.model || judgeModel,
    modelRequested: judgeModel,
  };

  const judgeResultPath = path.join(artifactDir, "judge-result.json");
  fs.writeFileSync(judgeResultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const requiredFailures = Array.isArray(result.requiredFailures) ? result.requiredFailures : [];
  if (requiredFailures.length > 0) {
    console.error("Judge failed required stories:");
    for (const storyId of requiredFailures) {
      console.error(`- ${storyId}`);
    }
    console.error(`Judge artifact: ${judgeResultPath}`);
    process.exit(1);
  }

  console.log(`Judge completed. Artifact: ${judgeResultPath}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
