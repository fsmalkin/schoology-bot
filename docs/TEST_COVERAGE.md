# Test Coverage and Gaps

This document summarizes current test coverage and the known gaps.

## Coverage summary

Unit tests
- DB schema migrations and CRUD for tasks/reminders/notes.
- Legacy reminder -> task migration and recurrence column migration.
- Status normalization and auto-ignore rules.
- Summary builder (actionable vs pending).
- Readable message formatter (Do Now/Soon/Waiting routing, status wording, links, caps).
- Reminder assumption inference (cadence/time defaults and unsupported cadence fallback).
- Reminder normalization edge-cases (model-supplied time override, unsupported-cadence warning when recurrence is pre-normalized, and date-cue preservation while defaulting time).
- Refresh login-failure messaging when `SCHOLOGY_IDP` is already configured (avoids redundant provider prompts).
- Login-failure Telegram alert throttling (first alert, cooldown suppression, changed-error resend, post-success resend).
- Assignment identity canonicalization (`assignment:<id>`) and legacy-key merge behavior.
- Assignment identity migration v6 (backfill `assignment_id`, dedupe by ID, and reference relink for notes/tasks).
- Dashboard health/data builders (heartbeat + snapshot shaping).
- Dashboard parent-home and schoolwork data builders (home section classification, parent-facing labels, assignment notes preview, reminder summary, and task-only filtering).
- Dashboard browser smoke coverage for click-to-open cards, the minimal card surface, collapsed drawer sections, explicit assignment status saves, visible Schoology refresh busy/success feedback, backdrop/escape close behavior, and bulk-mode reveal.
- Time parsing and timezone formatting (local labels, shorthand).
- Reminder rollovers (one-time + recurring cadence next-run math, DST wall-clock checks).
- Bug filing guardrails (no empty body).
- Telegram formatting sanitization.
- Capability registry rendering and runtime limits.
- Capability guard behavior (unsupported request blocked with fallback; supported request proceeds to tools).
- Agent mock recurring story flow (assumption confirmation + conversational correction).

Integration tests
- OpenAI live plan tests (tool planning and schema format).
- Live API simulation using dummy data.
- Reminder delivery flow (runReminders with mocked Telegram sender).
- Dashboard HTTP integration (page/assets, `GET /api/home`, read APIs, same-origin write guard, and assignment/task mutation routes).
- Dashboard browser smoke (`tests/dashboard_ui_smoke.test.js`) for the card-first interaction model.
- Agentic story suite runner (`scripts/run_agentic_story_suite.mjs`) for chat-only release stories.
- Single-pass acceptance judge (`scripts/judge_agentic_story_suite.mjs`) producing strict JSON evidence.

Smoke tests
- Docker smoke script: `scripts/smoke_docker.ps1` for build + health check.
- Ops DR scripts now include dry-run/manual smoke coverage:
  - `scripts/start_schoology_stacks.ps1 -DryRun`
  - `scripts/create_schoology_pre_cutover_snapshot.ps1 -DryRun`
  - `scripts/backup_schoology_state.ps1 -DryRun`
  - `scripts/run_schoology_restore_drill.ps1 -DryRun`
  - `scripts/restore_schoology_state.ps1 -DryRun`
  - `scripts/register_schoology_tasks.ps1 -DryRun -RunAsPassword "<password>"`
  - `scripts/check_schoology_backup_freshness.ps1` (status-file check)

CLI checks
- Manual CLI runs via `npm run agent:cli -- "..."` for basic flows.
- Release gate scripts:
  - `npm run beta:reset-memory`
  - `npm run stories:run`
  - `npm run stories:judge`
- Recovery/operations scripts:
  - `powershell -ExecutionPolicy Bypass -File scripts/start_schoology_stacks.ps1 -RuntimeMode docker`
  - `powershell -ExecutionPolicy Bypass -File scripts/create_schoology_pre_cutover_snapshot.ps1`
  - `powershell -ExecutionPolicy Bypass -File scripts/backup_schoology_state.ps1 -RuntimeMode docker`
  - `powershell -ExecutionPolicy Bypass -File scripts/run_schoology_restore_drill.ps1 -Source local`
  - `powershell -ExecutionPolicy Bypass -File scripts/restore_schoology_state.ps1 -RuntimeMode docker -Source local -Snapshot latest`
  - `powershell -ExecutionPolicy Bypass -File scripts/register_schoology_tasks.ps1 -RuntimeMode docker -RunAsPassword "<password>"`

## Gaps and risks

Schoology scraping (live)
- No automated live Schoology login/scrape tests.
- Playwright flow can regress if Schoology UI changes.

Telegram end-to-end
- No automated E2E tests for Telegram receive -> tool -> send.
- Manual UAT required after changes to agent or formatting.

Reminder delivery timing
- Automated test covers delivery + rollover with a fixed clock.
- Cron scheduling is not validated under real clock drift in production-like load.

Bug filing to GitHub
- No automated integration test for GitHub issue creation (avoids live API calls).
- Relies on unit guards + manual verification.

OpenClaw stack
- Tool API cron-facing flows covered by unit tests (`tests/tool_runner_openclaw_cron.test.js`).
- No automated tests for OpenClaw gateway UI.
- Cron bootstrap behavior (`scripts/openclaw_cron_sync.mjs`) is validated via docker runtime logs, not unit tests.

Performance and reliability
- No load or soak tests.
- Network failure handling not stress tested.
- Restore drill validates snapshot integrity and SQLite bundle completeness, but not full in-place runtime rollback.
- Scheduled-task execution health is monitored via freshness status, not integration tests.

## Near-term additions (recommended)
- Add a Telegram E2E test harness that runs against a test bot and test chat.
- Add a reminder delivery integration test using a fake clock.
- Add a live scrape smoke test behind a feature flag.
