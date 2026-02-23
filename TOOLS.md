# TOOLS

This file is a short description of available tools and their expected behavior.
The agent should treat tool results as source of truth and avoid guessing.
Canonical capability metadata for planner/runtime guardrails lives in `src/capabilities.js`.

System expectations:
- Prefer library-first solutions before custom logic.
- If a tool returns an error, summarize once and ask for the minimum missing detail.
- Use pending actions for multi-step confirmations.

Tool capabilities and limits:
- Reminders: one-time and recurring reminders are supported.
- Supported recurring cadence: `daily`, `weekdays`, `weekly`.
- Unsupported cadence fallback: monthly/custom requests should fall back to weekly and be confirmed.
- Cron-safe summary tool (`build_daily_summary`): returns formatted summary text; it does not send directly.
- Cron-safe reminder drain tool (`drain_due_reminders`): returns due reminder messages and applies rollover state updates.
- Tasks: can be created, listed, updated, deleted; one-time tasks roll over 24h automatically if still pending.
- Assignment reminders: tied to a specific assignment; replaces existing pending reminder when requested.
- Refresh Schoology: resyncs data and updates local state; cannot change Schoology grades or submissions.
- Manual statuses + assignment notes: stored locally in our DB to help track what matters; they do not change anything in Schoology itself.
- Auto-ignore: system can auto-archive old/practice items; manual statuses always take precedence.
- Bug/feature filing: logs locally and can open GitHub issues if configured; no attachments.
