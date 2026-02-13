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

---

Title:
Reseat Schoology beta agent on OpenClaw gateway

Last updated:
2026-02-12

Goal:
- Run Schoology beta chat through OpenClaw (Telegram + session memory + queueing) while keeping Schoology-specific tools, skills, and local DB behavior.

Scope:
In scope:
- Add OpenClaw beta gateway config and compose wiring.
- Keep Schoology scheduler and tool API as existing Node services.
- Route Telegram beta bot traffic to OpenClaw (not legacy `telegram-agent-beta`).
- Validate with Docker smoke + CLI tool calls.
Out of scope:
- Prod cutover in the same slice.
- Replacing Schoology scraper/data model.
- Implementing new Schoology features.

Constraints and assumptions:
- Prod services stay online and untouched during beta cutover.
- Beta uses `.env.beta` and isolated state.
- OpenClaw should not interfere with Chasebot sessions.

Risks and mitigations:
Risk:
- Description: OpenClaw and legacy beta Telegram agent poll the same bot token.
- Impact: 409 conflicts and duplicate/missing replies.
- Mitigation: Stop `telegram-agent-beta` before starting OpenClaw beta gateway.

Risk:
- Description: OpenClaw starts without Telegram channel config.
- Impact: Gateway runs but does not process Telegram.
- Mitigation: Provide pinned `openclaw.json` with explicit `channels.telegram` section.

Risk:
- Description: Session/tool state cross-contaminates with other OpenClaw agents.
- Impact: Wrong memory/context behavior.
- Mitigation: Isolate OpenClaw home path and workspace mount for Schoology beta.

Plan:
Phase 1 - Wire OpenClaw beta runtime
Tasks:
- Add `openclaw_workspace/openclaw.beta.json5` with Telegram, model, queue, and skill filters.
- Update `docker-compose.beta-openclaw.yml` with isolated project/service names and OpenClaw config mount.
- Ensure Schoology tool API and scheduler run with beta paths.
Dependencies:
- Existing `src/openclaw_tool_api.js` and workspace skills.
End state:
- OpenClaw beta gateway starts cleanly and is connected to Schoology tool API.

Phase 2 - Validate and document
Tasks:
- Run Docker smoke checks (health/logs/services).
- Run CLI check against Schoology tool API through helper script.
- Update roadmap/system docs with deployment/rollback notes.
Dependencies:
- Phase 1 complete.
End state:
- Beta is ready for UAT; clear promotion checklist documented.

Validation plan:
Unit tests:
- `npm test` (existing suite) on branch after config changes.
Integration tests:
- OpenClaw gateway startup + tool API health + Schoology tool call.
Smoke tests:
- `docker compose -f docker-compose.beta-openclaw.yml --env-file .env.beta up -d --build`
- Verify gateway logs show Telegram channel active.
- Verify one tool call via `openclaw_workspace/tools/schoology_api.js`.
Manual checks (if any):
- Beta Telegram: ask for missing assignments and a status update.

Rollback plan:
- Stop OpenClaw beta stack.
- Restart legacy beta stack (`docker-compose.beta.yml`) if needed.
- No prod rollback needed because prod remains on current stack until explicit promotion.

Open questions:
- Whether to enforce stricter Telegram allowlists in beta before prod cutover.

Notes:
- 2026-02-12: Context continuity fix was already shipped separately to prod (`main`, commit `8791764`).
