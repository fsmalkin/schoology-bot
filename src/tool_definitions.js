// Pure tool names and JSON schemas shared by runtime and offline setup rendering.
export const TOOL_NAMES = [
  "list_assignments",
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "bulk_update_assignments_by_filter",
  "apply_numbered_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "list_assignment_reminders",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "refresh_schoology",
  "build_daily_summary",
  "drain_due_reminders",
  "create_task",
  "list_tasks",
  "update_task_status",
  "update_task",
  "delete_task",
  "open_bug_report",
  "open_feature_request",
];

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

export function toolDefinitions() {
  return [
    {
      type: "function",
      name: "list_assignments",
      description:
        "List assignments with optional filters. Rows include dueCategory (overdue, today, upcoming, undated). Use status=submitted_awaiting_grade for Schoology rows marked Submitted, Submitted awaiting grade, submitted/ungraded icon, or hidden grade-pending text.",
      strict: true,
      parameters: buildStrictParams({
        status: {
          type: "string",
          enum: ["missing", "resolved", "all", "submitted_awaiting_grade"],
          description: "Filter by missing/resolved/all/submitted-awaiting-grade.",
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
          description:
            "Include ignored or auto-filed statuses (default false, true by default for submitted_awaiting_grade).",
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
      name: "bulk_update_assignments_by_filter",
      description:
        "Set one local manual status for missing assignments matching safe filters such as dueBefore or dueOnOrBefore. Use for requests like 'mark everything before 4/4 as no action needed'.",
      strict: true,
      parameters: buildStrictParams(
        {
          targetStatus: {
            type: "string",
            description:
              "New manual status. Use C or 'No action needed' when the user says no action needed.",
          },
          assignmentStatus: {
            type: "string",
            enum: ["missing", "resolved", "all", "submitted_awaiting_grade"],
            description: "Assignment source filter. Default missing.",
          },
          course: {
            type: "string",
            description: "Optional course name substring.",
          },
          dueBefore: {
            type: "string",
            description: "Optional exclusive due-date cutoff, preferably YYYY-MM-DD.",
          },
          dueOnOrBefore: {
            type: "string",
            description: "Optional inclusive due-date cutoff, preferably YYYY-MM-DD.",
          },
          includePending: {
            type: "boolean",
            description: "Include pending manual statuses; default true.",
          },
          includeIgnored: {
            type: "boolean",
            description: "Include already ignored/local no-action statuses; default false.",
          },
          maxUpdates: {
            type: "integer",
            minimum: 1,
            maximum: 1000,
            description: "Safety cap; default 200.",
          },
          dryRun: {
            type: "boolean",
            description: "Preview only without writing.",
          },
        },
        ["targetStatus"]
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
            description:
              "Reminder time in ISO-8601 or natural language. Optional for recurring requests; defaults will be inferred.",
          },
          message: {
            type: "string",
            description: "Optional reminder message.",
          },
          recurrence: {
            type: "string",
            enum: ["none", "daily", "weekdays", "weekly"],
            description: "Optional recurrence cadence.",
          },
          recurrenceTz: {
            type: "string",
            description: "Optional IANA timezone for recurrence expansion.",
          },
          replaceExisting: {
            type: "boolean",
            description: "Replace existing pending reminder(s) for the same assignment.",
          },
        }
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
          recurrence: {
            type: "string",
            enum: ["none", "daily", "weekdays", "weekly"],
            description: "Optional recurrence cadence update.",
          },
          recurrenceTz: {
            type: "string",
            description: "Optional recurrence timezone update.",
          },
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
          remindAt: {
            type: "string",
            description:
              "Reminder time in ISO-8601 or natural language. Optional for recurring requests; defaults will be inferred.",
          },
          message: { type: "string", description: "Optional reminder note." },
          recurrence: {
            type: "string",
            enum: ["none", "daily", "weekdays", "weekly"],
            description: "Optional recurrence cadence.",
          },
          recurrenceTz: {
            type: "string",
            description: "Optional IANA timezone for recurrence expansion.",
          },
        },
        ["title"]
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
          recurrence: {
            type: "string",
            enum: ["none", "daily", "weekdays", "weekly"],
            description: "Optional recurrence cadence update.",
          },
          recurrenceTz: {
            type: "string",
            description: "Optional recurrence timezone update.",
          },
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
