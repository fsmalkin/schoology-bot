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
Recurring Reminders Release (Agent-Mediated + GPT-5.2 Story Gate)

Last updated:
2026-02-22

Goal:
- Ship recurring reminders end-to-end for assignment-linked and personal reminders, with agent-mediated assumptions and a single GPT-5.2 acceptance-judge pass before user UAT.

Scope:
In scope:
- Recurrence support for `daily`, `weekdays`, `weekly`.
- Reminder data model unification on `tasks` (including assignment reminders).
- Agent-mediated inference for recurring cadence/time defaults and create-then-confirm messaging.
- Beta reset from prod memory flow for `schoology-beta`.
- Agentic story suite execution and single-pass GPT-5.2 judge artifacts.
- Process institutionalization updates in roadmap/pattern docs.
Out of scope:
- Monthly/custom recurrence execution.
- Auto-cancel enhancement #10.
- UI redesign.

Constraints and assumptions:
- Runtime timezone defaults to `America/New_York`.
- External `openclaw-beta` runtime from other workspace is untouched.
- Legacy one-time rollover behavior is preserved.
- Missing cadence on explicit recurring asks defaults to `weekdays`.
- Missing recurring time defaults:
  - 7:00 AM ET for morning/school-start cues.
  - 4:30 PM ET for check-in/follow-up cues.
  - 9:00 PM ET fallback.
- Judge policy is exactly one GPT-5.2 run with evidence artifacts.

Risks and mitigations:
Risk:
- Recurrence defaults create unintended reminders.
Impact:
- User trust regression and incorrect scheduling.
Mitigation:
- Explicit assumption evidence in tool output + response confirmation with one-step correction examples.

Risk:
- Reminder migration regresses existing assignment reminder behavior.
Impact:
- Legacy reminders may duplicate or disappear.
Mitigation:
- Migration test coverage for pending legacy reminders -> tasks and duplicate protection.

Risk:
- Beta reset procedure accidentally impacts non-target runtime.
Impact:
- Operational disruption in other workspace.
Mitigation:
- Script hard-codes `schoology-beta` compose project and only prod/beta DB volumes.

Risk:
- Story gate drift between heuristic checks and judge verdict.
Impact:
- Unclear acceptance signal.
Mitigation:
- Preserve transcripts + tool snapshots per story and require judge evidence snippets per verdict.

Plan:
Phase 1 - Data and runtime core
Tasks:
- Add recurrence fields to task schema and migration path.
- Migrate pending legacy `reminders` rows into `tasks` (`kind='assignment'`).
- Repoint assignment reminder CRUD operations to tasks.
- Make reminder runner recurrence-aware with timezone-safe next-run math.
Dependencies:
- Existing DB migration framework and task runner.
End state:
- Assignment and personal reminders share one recurring-capable task model.

Phase 2 - Agent mediation and capability updates
Tasks:
- Expand tool schemas for recurrence fields.
- Add inference helpers for cadence/time defaults and unsupported cadence fallback.
- Inject assumptions into reminder tool calls and output payloads.
- Update readable confirmation responses to include:
  - what was assumed,
  - what was created/updated,
  - one-step correction examples.
- Update capabilities/guardrails to support recurring scope and fallback policy.
Dependencies:
- Phase 1 complete.
End state:
- Agent proactively handles recurring reminders with explicit assumption confirmation.

Phase 3 - Validation automation and beta reset SOP
Tasks:
- Add/expand tests for migration, recurrence math, inference behavior, and mock conversation correction flow.
- Add `scripts/reset_beta_from_prod_memory.ps1` with verification report artifacts.
- Add `scripts/run_agentic_story_suite.mjs` for chat-only story execution with transcript/tool snapshot artifacts.
- Add `scripts/judge_agentic_story_suite.mjs` for single-pass GPT-5.2 judge JSON output.
Dependencies:
- Phase 1 and Phase 2 complete.
End state:
- Repeatable pre-UAT gate with artifacts and beta reset reproducibility.

Phase 4 - Process institutionalization
Tasks:
- Update roadmap/backlog/system/test-coverage docs for mandatory release flow.
- Add reusable pattern doc for other projects.
- Record decision + outcome for this release pattern.
Dependencies:
- Phase 3 complete.
End state:
- Agentic release gate is documented as default development pattern.

Validation plan:
Unit tests:
- Reminder assumptions helper tests.
- Recurrence CRUD and recurrence math tests.
- Readable response/agent mock coverage for assumption confirmation and corrections.
Integration tests:
- Full `npm test` run.
Smoke tests:
- `npm run stories:run`
- `npm run stories:judge`
- `npm run beta:reset-memory` (or direct script execution) for reset report artifact generation.
Manual checks (if any):
- Review judge evidence JSON and per-story transcripts before UAT.
- Confirm beta reset report metrics match between prod and beta snapshots.

Rollback plan:
- Revert to last stable commit/image and rebuild containers.
- Restore pre-release DB backup snapshot.
- Validate one-time reminder baseline behavior before re-opening work.

Open questions:
- None for this execution slice.

Notes:
- 2026-02-22: Decision - recurring scope locked to daily/weekdays/weekly for this release.
- 2026-02-22: Decision - create-then-confirm with assumptions + quick edit prompt is mandatory for reminder writes.
- 2026-02-22: Decision - acceptance gate uses one GPT-5.2 judge run with evidence (no second pass).
