const TOOL_CAPABILITY_REGISTRY = {
  list_assignments: {
    summary: "List assignments with filters and optional actionable/pending/ignored buckets.",
    supports: ["read_assignments"],
  },
  update_assignment_status: {
    summary: "Set one local manual status for a matching assignment.",
    supports: ["write_assignment_status"],
    requires: ["assignment key or title"],
  },
  bulk_update_assignment_statuses: {
    summary: "Set local manual statuses for multiple assignments.",
    supports: ["write_assignment_status"],
    requires: ["assignment selectors per row"],
  },
  apply_numbered_statuses: {
    summary: "Apply manual statuses by index from the current missing list ordering.",
    supports: ["write_assignment_status"],
    requires: ["statusByIndex entries"],
  },
  add_assignment_note: {
    summary: "Add a local note to an assignment.",
    supports: ["write_assignment_note"],
    requires: ["assignment key or title", "note text"],
  },
  schedule_reminder: {
    summary: "Create or replace one assignment reminder at a specific time.",
    supports: ["write_assignment_reminder"],
    limitations: ["one-time reminders only"],
    requires: ["assignment key or title", "remindAt"],
  },
  list_assignment_reminders: {
    summary: "List reminders for one assignment.",
    supports: ["read_assignment_reminders"],
    requires: ["assignment key"],
  },
  update_assignment_reminder: {
    summary: "Update one assignment reminder time and/or message.",
    supports: ["write_assignment_reminder"],
    requires: ["reminder id"],
  },
  delete_assignment_reminder: {
    summary: "Delete one assignment reminder.",
    supports: ["write_assignment_reminder"],
    requires: ["reminder id"],
  },
  refresh_schoology: {
    summary: "Run scrape + reconcile local statuses with safe transitions.",
    supports: ["refresh_source_data"],
    limitations: ["does not change grades or submissions in Schoology"],
  },
  create_task: {
    summary: "Create one standalone reminder/task.",
    supports: ["write_task"],
    limitations: ["one-time reminders only"],
    requires: ["title", "remindAt"],
  },
  list_tasks: {
    summary: "List standalone tasks/reminders with optional date filters.",
    supports: ["read_task"],
  },
  update_task_status: {
    summary: "Mark a task done or pending.",
    supports: ["write_task"],
    requires: ["task id", "status"],
  },
  update_task: {
    summary: "Update task title, reminder time, or message.",
    supports: ["write_task"],
    requires: ["task id"],
  },
  delete_task: {
    summary: "Delete one task.",
    supports: ["write_task"],
    requires: ["task id"],
  },
  open_bug_report: {
    summary: "Log a bug locally and optionally create a GitHub issue.",
    supports: ["log_bug"],
    limitations: ["GitHub URL requires GITHUB_REPO and GITHUB_TOKEN"],
    requires: ["title", "body"],
  },
  open_feature_request: {
    summary: "Log a feature request locally and optionally create a GitHub issue.",
    supports: ["log_feature"],
    limitations: ["GitHub URL requires GITHUB_REPO and GITHUB_TOKEN"],
    requires: ["title", "body"],
  },
};

const GLOBAL_LIMITS = [
  {
    id: "recurring_reminders",
    constraint: "Recurring reminders are not supported.",
    fallback: "Offer a one-time reminder and offer to adjust later.",
  },
  {
    id: "schoology_writeback",
    constraint: "The bot cannot change Schoology grades/submission records.",
    fallback: "Use local notes/statuses/reminders and suggest teacher follow-up.",
  },
];

export function getCapabilityRegistry({ allowedTools = null, config = null } = {}) {
  const allowedSet = Array.isArray(allowedTools) && allowedTools.length > 0
    ? new Set(allowedTools)
    : null;
  const tools = Object.entries(TOOL_CAPABILITY_REGISTRY)
    .filter(([name]) => !allowedSet || allowedSet.has(name))
    .map(([name, meta]) => ({ name, ...meta }));

  const githubEnabled = Boolean(config?.github?.repo && config?.github?.token);
  return {
    tools,
    limits: GLOBAL_LIMITS.map((row) => ({ ...row })),
    integrations: {
      githubIssueCreate: githubEnabled,
    },
  };
}

export function buildCapabilitySummary({ allowedTools = null, config = null } = {}) {
  const registry = getCapabilityRegistry({ allowedTools, config });
  const lines = [];
  lines.push("Capability registry:");
  for (const tool of registry.tools) {
    lines.push(`- ${tool.name}: ${tool.summary}`);
    if (Array.isArray(tool.limitations) && tool.limitations.length > 0) {
      lines.push(`  limits: ${tool.limitations.join("; ")}`);
    }
    if (Array.isArray(tool.requires) && tool.requires.length > 0) {
      lines.push(`  requires: ${tool.requires.join(", ")}`);
    }
  }
  lines.push("Global limits:");
  for (const limit of registry.limits) {
    lines.push(`- ${limit.constraint} Fallback: ${limit.fallback}`);
  }
  lines.push(
    `- GitHub issue creation is ${
      registry.integrations.githubIssueCreate ? "configured" : "not configured"
    }.`
  );
  return lines.join("\n");
}

export function capabilityListForPrompt({ allowedTools = null, config = null } = {}) {
  const registry = getCapabilityRegistry({ allowedTools, config });
  return {
    tools: registry.tools.map((tool) => ({
      name: tool.name,
      summary: tool.summary,
      requires: tool.requires || [],
      limitations: tool.limitations || [],
    })),
    limits: registry.limits,
    integrations: registry.integrations,
  };
}
