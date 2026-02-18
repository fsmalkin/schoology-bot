# Codex Execution Plans (ExecPlans)

This file defines how we create and maintain execution plans for larger work.

## Purpose
- Make complex work predictable and reviewable.
- Keep scope, risks, and validation explicit.
- Provide a living plan that is updated as we learn.

## When to use an ExecPlan
Create an ExecPlan when work is:
- Multi-step or multi-hour
- A refactor or redesign
- Multi-milestone with dependencies
- Risky (could break prod, data, or UX)

## Where to write the ExecPlan
- Use this file as the single ExecPlan document.
- Keep it current while you work (it is a living plan).

## Required content
An ExecPlan must include:
- Goal
- Scope and non-goals
- Constraints and assumptions
- Risks and mitigations
- Step-by-step plan with milestones
- Validation plan (tests + checks)
- Rollback plan
- Open questions (if any)

## ExecPlan template (use this structure)

Title:
<short plan title>

Last updated:
YYYY-MM-DD

Goal:
- What outcome we want, in one or two sentences.

Scope:
In scope:
- ...
Out of scope:
- ...

Constraints and assumptions:
- ...

Risks and mitigations:
Risk:
- Description:
- Impact:
- Mitigation:

Plan:
Phase 1 - <name>
Tasks:
- ...
Dependencies:
- ...
End state:
- ...

Phase 2 - <name>
Tasks:
- ...
Dependencies:
- ...
End state:
- ...

Validation plan:
Unit tests:
- ...
Integration tests:
- ...
Smoke tests:
- ...
Manual checks (if any):
- ...

Rollback plan:
- How to revert quickly if needed.

Open questions:
- ...

Notes:
- Decision log or important context.

## Plan change rules
- If the plan changes, update this file immediately.
- Keep a short change log in Notes with date and reason.

## Format rules
- ASCII only.
- Plain Markdown.
- No code blocks unless explicitly required.

---

Title:
OpenClaw One-Gateway Beta Migration

Last updated:
2026-02-16

Goal:
- Move the beta runtime to a one-gateway OpenClaw architecture while preserving Schoology domain behavior via the existing tool API sidecar and validating parity before any production cutover.

Scope:
In scope:
- Beta stack topology shift from `schoology + schoology-tool-api + openclaw-gateway` to `schoology-tool-api + openclaw-gateway` with gateway-owned cron scheduling.
- Add gateway-facing cron-safe tool endpoints for daily summary generation and due reminder draining.
- Add automated cron job sync/bootstrap for OpenClaw gateway (idempotent, named managed jobs).
- Keep legacy production compose untouched during beta validation.
- Update OpenClaw workspace skill instructions to include new cron tools.
- Update docs and test coverage notes for the new beta runtime behavior.
Out of scope:
- Full production cutover to one-gateway.
- Replacing Schoology tool API sidecar with OpenClaw-native plugin tooling.
- MCP migration for Schoology tools.

Constraints and assumptions:
- Migration scope is beta-first with phased dual-run and manual acceptance gate.
- Telegram IO in target beta flow is gateway-native.
- Scheduler ownership in target beta flow is OpenClaw cron.
- Schoology domain data/tool execution remains in existing Node code exposed by `schoology-tool-api`.
- Existing DB/state files remain the source of truth.

Risks and mitigations:
Risk:
- Duplicate or stale cron jobs causing repeated outputs.
Impact:
- Duplicate reminders/summaries and noisy Telegram output.
Mitigation:
- Cron sync removes managed jobs by name before re-adding desired definitions.

Risk:
- Reminder/scheduler logic drift when moved from Node scheduler loop to cron-triggered tool calls.
Impact:
- Behavioral regressions in reminder rollover or summary output.
Mitigation:
- Reuse existing summary/reminder logic via shared functions and add dedicated tool-level tests.

Risk:
- Beta/prod operational confusion during dual-run.
Impact:
- Wrong logs checked or wrong bot/token tested.
Mitigation:
- Keep beta compose + docs explicit, with separate service names and cron bootstrap behavior documented.

Plan:
Phase 1 - Tooling and runtime primitives
Tasks:
- Add cron-safe tool operations:
  - `build_daily_summary` (returns summary text without direct channel send).
  - `drain_due_reminders` (returns due reminder messages and applies rollover/sent markers).
- Refactor/reuse summary build path so scheduler send and tool path share logic.
- Keep backwards compatibility with existing scheduler + telegram-agent flows.
Dependencies:
- Existing `tasks.js`, `tool_runner.js`, DB and message formatter modules.
End state:
- OpenClaw gateway can trigger deterministic summary/reminder behavior through tool API without running legacy scheduler.

Phase 2 - Beta compose + cron ownership
Tasks:
- Update `docker-compose.beta-openclaw.yml` to:
  - remove legacy beta scheduler dependency,
  - keep `schoology-tool-api`,
  - keep `openclaw-gateway`,
  - add `openclaw-cron-sync` bootstrap service.
- Add cron sync script that waits for gateway health, removes managed jobs, and recreates:
  - Schoology scrape refresh (no deliver),
  - Daily summary deliver,
  - Due reminders deliver.
Dependencies:
- Phase 1 tool endpoints.
- OpenClaw CLI available in gateway image.
End state:
- Beta stack schedules are gateway-owned and recreated idempotently on stack startup.

Phase 3 - Docs and verification
Tasks:
- Add unit/integration tests for new tool behaviors.
- Update OpenClaw skill docs in workspace for new tool names and cron usage.
- Update system/openclaw/test coverage docs with decision + outcome notes.
Dependencies:
- Phase 1 and Phase 2 complete.
End state:
- Migration behavior is documented and test-covered for beta operations.

Validation plan:
Unit tests:
- New tool tests for `build_daily_summary` and `drain_due_reminders`.
- Existing scheduler/summary/reminder tests remain green.
Integration tests:
- `npm test` full suite.
Smoke tests:
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta up -d --build`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-cron-sync`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 schoology-tool-api`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-gateway`
Manual checks (if any):
- Confirm cron jobs exist exactly once in gateway.
- Confirm beta bot receives summary/reminder outputs from gateway-owned schedules.
- Confirm scrape refresh runs without legacy scheduler service.

Rollback plan:
- Revert migration commit(s), then rebuild legacy stack.
- For beta: restore prior `docker-compose.beta-openclaw.yml` and restart stack.
- For prod safety: no production compose changes in this scope.

Open questions:
- None for this execution slice.

Notes:
- 2026-02-16: Decision - beta-first, phased dual-run, manual acceptance gate.
- 2026-02-16: Decision - gateway-native Telegram + gateway cron in target beta runtime.
- 2026-02-16: Decision - keep Schoology Tool API sidecar for migration safety.
- 2026-02-16: Decision - reduce Docker sprawl by reusing shared image tags in compose stacks; OpenClaw beta targets `schoology-beta-openclaw-unified:latest`.
