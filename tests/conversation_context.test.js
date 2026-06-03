import test from "node:test";
import assert from "node:assert/strict";
import { createDb, getConversationContext, setConversationContext, syncAssignmentsFromState } from "../src/db.js";
import {
  CONTEXT_TYPES,
  buildAssignmentListContextFromTurn,
  buildShortLivedConversationContextPrompt,
  recordCreatedIssueContext,
  recordDisplayedAssignmentListContext,
} from "../src/conversation_context.js";
import { runToolByName } from "../src/tool_runner.js";

function seedAssignments(db) {
  syncAssignmentsFromState(db, {
    assignments: {
      chorus: {
        key: "assignment:8401501960",
        course: "Chorus",
        title: "Spring Concert Reflection",
        dueDate: "5/22/26 11:59pm",
        status: "Missing",
        isMissing: true,
      },
      magley: {
        key: "assignment:8386979006",
        course: "Science",
        title: "Lab: MAGLEY Review",
        dueDate: "5/11/26 11:59pm",
        status: "Submitted",
        url: "https://bcps.schoology.com/assignment/8386979006",
        isMissing: true,
      },
      pba: {
        key: "assignment:8404560786",
        course: "Language Arts",
        title: "Unit 4 PBA TURN-IN Nature and People Presentation",
        dueDate: "6/5/26 8:00am",
        status: "Missing",
        isMissing: true,
      },
    },
  });
}

test("conversation context stores and expires short-lived payloads", () => {
  const db = createDb(":memory:");

  const result = setConversationContext(db, {
    chatId: "chat-ctx",
    type: "demo",
    payload: { ok: true },
    updatedAt: "2026-06-02T10:00:00.000Z",
    ttlHours: 1,
  });
  assert.equal(result.ok, true);

  assert.deepEqual(
    getConversationContext(db, "chat-ctx", "demo", { now: "2026-06-02T10:30:00.000Z" })?.payload,
    { ok: true }
  );
  assert.equal(
    getConversationContext(db, "chat-ctx", "demo", { now: "2026-06-02T12:00:00.000Z" }),
    null
  );
});

test("assignment list context maps assistant-displayed numbers to assignment keys", () => {
  const executed = [
    {
      call: { name: "list_assignments", arguments: { status: "missing", bucketed: true } },
      output: {
        ok: true,
        assignments: {
          buckets: {
            actionable: [
              { key: "assignment:8401501960", course: "Chorus", title: "Spring Concert Reflection" },
              { key: "assignment:8386979006", course: "Science", title: "Lab: MAGLEY Review" },
            ],
            pending: [],
            ignored: [],
          },
        },
      },
    },
  ];

  const context = buildAssignmentListContextFromTurn({
    executed,
    reply: [
      "Here's the full list:",
      "1. Spring Concert Reflection - Chorus",
      "2. Lab: MAGLEY Review - Science",
    ].join("\n"),
  });

  assert.equal(context.source, "assistant_reply");
  assert.equal(context.items.find((item) => item.index === 2)?.key, "assignment:8386979006");
});

test("apply_numbered_statuses uses displayed assignment context before DB ordering", async () => {
  const db = createDb(":memory:");
  seedAssignments(db);

  recordDisplayedAssignmentListContext(db, {
    chatId: "chat-numbered",
    executed: [
      {
        call: { name: "list_assignments", arguments: { status: "missing", bucketed: true } },
        output: {
          ok: true,
          assignments: [
            {
              key: "assignment:8401501960",
              course: "Chorus",
              title: "Spring Concert Reflection",
            },
            {
              key: "assignment:8386979006",
              course: "Science",
              title: "Lab: MAGLEY Review",
            },
          ],
        },
      },
    ],
    reply: [
      "1. Spring Concert Reflection - Chorus",
      "2. Lab: MAGLEY Review - Science",
    ].join("\n"),
  });

  const result = await runToolByName(
    db,
    "apply_numbered_statuses",
    { statusByIndex: [{ index: 2, status: "C" }] },
    { chatId: "chat-numbered" }
  );

  assert.equal(result.source, "conversation_context");
  assert.equal(result.successCount, 1);
  const magley = db
    .prepare("SELECT manual_status AS manualStatus FROM assignments WHERE key = ?")
    .get("assignment:8386979006");
  assert.equal(magley.manualStatus, "No way to fix it");
});

test("created issue context links back to the displayed assignment", () => {
  const db = createDb(":memory:");
  recordDisplayedAssignmentListContext(db, {
    chatId: "chat-issue",
    executed: [
      {
        call: { name: "list_assignments", arguments: { status: "missing" } },
        output: {
          ok: true,
          assignments: [
            {
              key: "assignment:8386979006",
              course: "Science",
              title: "Lab: MAGLEY Review",
              url: "https://bcps.schoology.com/assignment/8386979006",
            },
          ],
        },
      },
    ],
    reply: "1. Lab: MAGLEY Review - Science",
  });

  const result = recordCreatedIssueContext(db, {
    chatId: "chat-issue",
    args: {
      title: "Submitted MAGLEY assignment shown as overdue",
      body: "Lab: MAGLEY Review should not be overdue.",
      labels: ["bug"],
    },
    output: { logged: true, issue: { ok: true, number: 36, url: "https://github.com/example/repo/issues/36" } },
    userText: "Open a bug - 1 should not be overdue",
  });

  assert.equal(result.ok, true);
  const prompt = buildShortLivedConversationContextPrompt(db, "chat-issue");
  assert.match(prompt, /lastDisplayedAssignmentList/);
  assert.match(prompt, /lastCreatedIssue/);
  assert.match(prompt, /assignment:8386979006/);
  assert.match(prompt, /36/);
});

test("db migration creates conversation context table", () => {
  const db = createDb(":memory:");
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_contexts'")
    .get();
  assert.ok(table);
  assert.equal(CONTEXT_TYPES.ASSIGNMENT_LIST, "last_displayed_assignment_list");
});
