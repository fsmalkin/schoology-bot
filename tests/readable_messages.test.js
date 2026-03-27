import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReadableDailySummary,
  buildReadableReminderMessage,
  buildReadableToolResponse,
  formatFriendlyStatus,
  simplifyCourseName,
} from "../src/readable_messages.js";
import {
  addAssignmentNote,
  closeDb,
  createDb,
  scheduleReminder,
  syncAssignmentsFromState,
} from "../src/db.js";

test("buildReadableDailySummary routes items to Do Now, Soon, and Waiting", () => {
  const summary = {
    actionable: [
      {
        course: "Algebra 1 GT/AA MS7: Sec 004 B PER03",
        title: "U5 Compound Interest/Intervals",
        dueDate: "1/23/26 11:59pm",
        status: "Absent",
        url: "https://example.com/a1",
      },
    ],
    pending: [
      {
        course: "Novice Latin Level B MS: Sec 001 A PER03",
        title: "January 30th-Tpc01C - Show What You Know (Graded: 1/31)",
        dueDate: "1/31/26 11:59pm",
        status: "Waiting on teacher",
        manualStatus: "Waiting on teacher",
        url: "https://example.com/p1",
      },
    ],
  };
  const reminders = {
    today: [],
    overdue: [],
    upcoming: [
      {
        title: "Follow up with Algebra teacher",
        remindAt: "2026-02-19T12:15:00Z",
        message: "Ask about redo/submit",
      },
    ],
  };
  const output = buildReadableDailySummary({
    summary,
    reminders,
    state: { lastScrapeAt: "2026-02-16T11:00:00Z" },
    timeZone: "America/New_York",
    now: "2026-02-16T12:00:00Z",
  });

  assert.match(output, /Schoology Summary \|/i);
  assert.match(output, /^Do Now/m);
  assert.match(output, /\nSoon\n/);
  assert.match(output, /\nWaiting\n/);
  assert.match(output, /\[Algebra 1 GT\/AA MS7\] U5 Compound Interest\/Intervals/);
  assert.match(output, /Needs fix now \(Absent\)/);
  assert.match(output, /Needs teacher reply \(Waiting on teacher\)/);
  assert.match(output, /Link: https:\/\/example.com\/a1/);
  assert.doesNotMatch(output, /Link: https:\/\/example.com\/p1/);
});

test("buildReadableDailySummary caps each section at five items", () => {
  const actionable = [];
  for (let i = 1; i <= 7; i += 1) {
    actionable.push({
      course: `Science: Sec ${i}`,
      title: `Lab ${i}`,
      dueDate: "2/20/26 11:59pm",
      status: "Missing",
      url: `https://example.com/${i}`,
    });
  }
  const output = buildReadableDailySummary({
    summary: { actionable, pending: [] },
    reminders: { today: [], overdue: [], upcoming: [] },
    state: {},
    timeZone: "America/New_York",
    now: "2026-02-16T12:00:00Z",
  });

  assert.match(output, /\.\.\.and 2 more/);
});

test("buildReadableDailySummary keeps due text fallback when parsing fails", () => {
  const output = buildReadableDailySummary({
    summary: {
      actionable: [
        {
          course: "Art MS7: Sec 001",
          title: "Freezing a Moment in Time Worksheet (2-9-26)",
          dueDate: "ASAP",
          status: "Missing",
        },
        {
          course: "Art MS7: Sec 001",
          title: "Poster Draft",
          dueDate: "",
          status: "Missing",
        },
      ],
      pending: [],
    },
    reminders: { today: [], overdue: [], upcoming: [] },
    state: {},
    timeZone: "America/New_York",
    now: "2026-02-16T12:00:00Z",
  });

  assert.match(output, /Due ASAP/);
  assert.match(output, /Due date not shown/);
});

test("buildReadableDailySummary expands MUA and supports plain-language mode", () => {
  const output = buildReadableDailySummary({
    summary: {
      actionable: [
        {
          course: "History 8: Sec 1",
          title: "MUA review sheet",
          dueDate: "2/20/26 11:59pm",
          status: "Missing",
          url: "https://example.com/mua",
        },
      ],
      pending: [],
    },
    reminders: {
      today: [],
      overdue: [],
      upcoming: [
        {
          title: "MUA follow-up",
          remindAt: "2026-02-19T12:15:00Z",
          message: "Check in",
        },
      ],
    },
    state: {},
    timeZone: "America/New_York",
    now: "2026-02-16T12:00:00Z",
    messageStyle: "plain_language",
  });

  assert.match(output, /Mid-Unit Assessment review sheet/);
  assert.match(output, /History 8: Mid-Unit Assessment review sheet\./);
  assert.match(output, /Status:/);
  assert.match(output, /Reminder:/);
});

test("buildReadableReminderMessage uses action-first line", () => {
  const output = buildReadableReminderMessage({
    task: {
      title: "Algebra 1 GT/AA MS7 - U5 Compound Interest/Intervals",
      message: "Auto reminder for upcoming due date (2/10/26 11:59pm).",
      remindAt: "2026-02-09T21:00:00Z",
    },
    timeZone: "America/New_York",
    now: "2026-02-09T20:00:00Z",
  });

  assert.match(output, /^Do Now/m);
  assert.match(output, /Work on Algebra 1 GT\/AA MS7 - U5 Compound Interest\/Intervals \|/);
});

test("buildReadableReminderMessage uses plain-language wording when requested", () => {
  const output = buildReadableReminderMessage({
    task: {
      title: "Algebra 1 GT/AA MS7 - MUA follow-up",
      message: "Auto reminder for upcoming due date (2/10/26 11:59pm).",
      remindAt: "2026-02-09T21:00:00Z",
    },
    timeZone: "America/New_York",
    messageStyle: "plain_language",
  });

  assert.match(output, /^Reminder/m);
  assert.match(output, /Mid-Unit Assessment follow-up/);
  assert.match(output, /Time:/);
});

test("buildReadableToolResponse uses readable sections", () => {
  const output = buildReadableToolResponse({
    executed: [
      {
        call: { name: "schedule_reminder", arguments: JSON.stringify({ title: "Homework 1" }) },
        output: {
          ok: true,
          assignment: { course: "Algebra: Sec 1", title: "Homework 1" },
          remindAtLabel: "Thu Feb 19, 2026, 7:15 AM EST",
        },
      },
      {
        call: { name: "refresh_schoology", arguments: "{}" },
        output: { ok: true, actionableCount: 1, pendingCount: 1, ignoredCount: 0 },
      },
    ],
    timeZone: "America/New_York",
    now: "2026-02-16T12:00:00Z",
  });

  assert.match(output, /^Do Now/m);
  assert.match(output, /\nSoon\n/);
  assert.match(output, /\nWaiting\n/);
  assert.match(output, /Saved reminder for \[Algebra\] Homework 1\./);
  assert.match(output, /waiting on teacher\/grade/i);
});

test("buildReadableToolResponse includes note/reminder context and pending explanation", () => {
  const db = createDb();
  try {
    syncAssignmentsFromState(db, {
      assignments: {
        a1: {
          key: "a1",
          course: "History 8",
          title: "MUA review sheet",
          dueDate: "2/20/26 11:59pm",
          status: "Missing",
          rawText: "",
          firstSeenAt: "2026-02-16T12:00:00Z",
          lastSeenAt: "2026-02-16T12:00:00Z",
          lastMissingAt: "2026-02-16T12:00:00Z",
          resolvedAt: null,
          isMissing: true,
        },
      },
    });
    addAssignmentNote(db, { key: "a1", note: "Teacher said finish in class." });
    scheduleReminder(db, {
      key: "a1",
      remindAt: "2026-02-17T16:00:00-05:00",
      message: "Check in after class",
    });

    const output = buildReadableToolResponse({
      executed: [
        {
          call: { name: "update_assignment_status", arguments: JSON.stringify({ key: "a1", status: "F" }) },
          output: {
            ok: true,
            assignment: { key: "a1", course: "History 8", title: "MUA review sheet" },
            status: "Will complete in class",
          },
        },
      ],
      db,
      timeZone: "America/New_York",
      now: "2026-02-16T12:00:00Z",
      messageStyle: "plain_language",
    });

    assert.match(output, /Updated status for \[History 8\] Mid-Unit Assessment review sheet\./);
    assert.match(output, /Saved notes: 1 total\./);
    assert.match(output, /Saved reminders: 1 pending reminder\./);
    assert.match(output, /Why it may still appear pending:/);
  } finally {
    closeDb();
  }
});

test("buildReadableToolResponse does not ask sign-in provider when IDP is configured", () => {
  const output = buildReadableToolResponse({
    executed: [
      {
        call: { name: "refresh_schoology", arguments: "{}" },
        output: {
          ok: false,
          error: "Login failed. Set SCHOLOGY_IDP in .env (e.g. 'microsoft') and retry. DEBUG_DUMP=true will capture the page.",
        },
      },
    ],
    schoologyIdp: "microsoft",
    timeZone: "America/New_York",
    now: "2026-02-17T03:00:00Z",
  });

  assert.match(output, /configured Microsoft \(BCPS \/ Office 365\)/i);
  assert.doesNotMatch(output, /Need your input:/i);
  assert.doesNotMatch(output, /Reply with your sign-in provider/i);
});

test("status and course helpers use friendly output", () => {
  assert.equal(simplifyCourseName("Algebra 1 GT/AA MS7: Sec 004 B PER03"), "Algebra 1 GT/AA MS7");
  assert.equal(formatFriendlyStatus("No grade put in yet"), "Grade not posted yet (No grade put in yet)");
  assert.equal(formatFriendlyStatus("Will complete in class"), "Will complete in class");
});
