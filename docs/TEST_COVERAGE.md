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
- Chat-memory persistence, message-style persistence, and resolved-assignment reminder cleanup helpers.
- Schoology scraper title fallback for rows that have visible text but no assignment link (`Note: This material is not available within Schoology` shape).
- Schoology scraper conflict handling for MUA/external-tool-link rows (score beats Missing badge, detail-page fallback for ambiguous rows, capped fallback volume).
- Submitted-but-ungraded assignment handling: scraper coverage for Schoology grade-pending/dropbox icon hidden text, DB auto-file behavior, and direct `submitted_awaiting_grade` assignment queries.
- Dashboard health/data builders (heartbeat + snapshot shaping).
- Dashboard parent-home and schoolwork data builders (home section classification, parent-facing labels, assignment notes preview, reminder summary, task-only filtering, and raw-text title fallback when stored titles are blank).
- Dashboard read models for `Will complete in class` and MUA display-title expansion.
- Dashboard browser smoke coverage for click-to-open cards, the minimal card surface, collapsed drawer sections, explicit assignment status saves, long-running Schoology refresh busy/success feedback, backdrop/escape close behavior, and bulk-mode reveal.
- Beta dashboard client-state safeguards in `beta_dashboard.js` (draft-preserving rerenders, focus-return fallback when cards move buckets, and safer `Submitted` partial-failure handling) are covered through dedicated browser smoke and regression scenarios.
- Time parsing and timezone formatting (local labels, shorthand).
- Reminder rollovers (one-time + recurring cadence next-run math, DST wall-clock checks).
- Bug filing guardrails (no empty body).
- Telegram formatting sanitization, including Markdown table conversion to Telegram-readable lists.
- Capability registry rendering and runtime limits.
- Capability guard behavior (unsupported request blocked with fallback; supported request proceeds to tools).
- Agent mock recurring story flow (assumption confirmation + conversational correction).
- Agent runtime memory replay/style-toggle coverage and richer readable follow-up formatting.

Integration tests
- OpenAI live plan tests (tool planning and schema format).
- Live API simulation using dummy data.
- Reminder delivery flow (runReminders with mocked Telegram sender).
- Reminder integration coverage for auto-cancel-on-resolve behavior without canceling pending manual-status items.
- Dashboard HTTP integration (page/assets, `GET /api/home`, read APIs, same-origin write guard, and assignment/task mutation routes).
- Dashboard browser smoke (`tests/dashboard_ui_smoke.test.js`) for the card-first interaction model.
- Dashboard beta HTTP integration (`tests/dashboard_server.test.js`) for `/beta`, `/beta/assets/beta.css`, and `/beta/assets/beta.js`.
- Dashboard beta browser smoke (`tests/dashboard_beta_ui_smoke.test.js`) for beta boot, view switching, assignment/task drawer flows, reminder CRUD, task CRUD, mobile drawer sizing, focus return, `Submitted` partial-failure feedback, draft preservation across rerendered view switches, stale assignment-detail response races, close-before-response behavior, and timer-driven health-poll rerenders.
- Agentic story suite runner (`scripts/run_agentic_story_suite.mjs`) for chat-only release stories.
- Story suite runner now routes through `runChatMessage`, so it can exercise the Managed Agents bridge when that runtime is selected by env.
- Story suite runner uses deterministic `AGENTIC_STORY_NOW` for reminder/date parsing in both legacy and Managed Agents runtime paths.
- Story suite includes a required submitted-but-ungraded icon-query story (`S9`) that must call `list_assignments` with `status=submitted_awaiting_grade`, include ignored rows, and avoid false empty/all-scored claims.
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
  - `npm run beta:reset-memory` (legacy OpenClaw beta only until Managed Agents dev runtime replaces this gate)
  - `npm run stories:run`
  - `npm run stories:judge`
- Managed Agents migration must add dev parity artifacts before this becomes the runtime release gate. `stories:judge` must run after `stories:run` completes because it consumes the completed artifact directory.
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
- Unit coverage verifies Telegram forum-topic/thread option normalization and per-thread target keys.
- Automated live inbound Telegram receive -> tool -> send is still not covered by a repeatable test harness.
- Manual UAT is required after changes to agent or formatting. Current beta-thread outbound smoke passed with `.env.managed-dev`; one inbound beta-thread message was handled by the Managed Agents path and recorded a `schoology-dev` managed session. One more inbound message should be captured against the current Dockerized managed-dev container instance.

Reminder delivery timing
- Automated test covers delivery + rollover with a fixed clock.
- Cron scheduling is not validated under real clock drift in production-like load.

Bug filing to GitHub
- No automated integration test for GitHub issue creation (avoids live API calls).
- Relies on unit guards + manual verification.

Managed Agents stack
- Tracking: [#25 parent](https://github.com/fsmalkin/schoology-bot/issues/25), [#30 parity gate](https://github.com/fsmalkin/schoology-bot/issues/30), [Managed Agents migration doc](managed-agents/README.md).
- Config parsing/validation and chat-to-session mapping are covered by `tests/managed_agent_sessions.test.js`.
- Migration coverage verifies `managed_agent_sessions` creation in `tests/migrations.test.js`.
- Mock Managed Agents bridge coverage in `tests/managed_agent_bridge.test.js` verifies session creation/reuse, Telegram text event send, assistant text collection, local custom Schoology tool result handling, speculative pre-tool assistant text clearing after tool execution, repeated action-id dedupe before local tool execution, unsupported custom tool errors, built-in tool denial, deterministic invalid-arg errors, bounded large result payloads, and tool-round limits.
- `tests/managed_agent_tools.test.js` verifies exported Managed Agents custom tool definitions cover the current Schoology tool surface.
- `tests/managed_agent_definitions.test.js` verifies the Managed Agents system prompt keeps the reminder-default policy needed by parity stories and routes submitted/ungraded questions through the icon-aware filter.
- Live Managed Agents parity now has artifacts from the story suite and judge (`20260527-052502`) using Claude sessions and local Schoology custom tools, including the submitted/ungraded icon-query story.
- A broader isolated live Managed Agents JTBD UAT passed with Claude session `sesn_01HpAfEZH9345jZQC5Fh9dbB`, covering seeded assignment listing, manual status update, assignment note, assignment-linked reminder, standalone recurring reminder, correction/update, unsupported monthly fallback, daily summary, and due-reminder drain.
- Beta Schoology auth was refreshed after stale storage was confirmed, and a live Managed Agents dev repro passed with Claude session `sesn_018Gc6shAGPFyDd6DGXhLSw9`: `refresh_schoology` succeeded against real Schoology data, then `list_assignments` returned zero actionable, pending, or ignored missing assignments.
- A live Managed Agents submitted/ungraded icon-query smoke passed with Claude session `sesn_017YiTWYQ4FT6unZ6DLXaMp8`, calling `list_assignments` with `status=submitted_awaiting_grade` and returning the two historical beta rows marked by Schoology's hidden submitted/ungraded text.
- After the bridge speculative-text fix, live beta-data Managed Agents submitted/ungraded smokes passed locally (`sesn_01LaHRC29pzSYAsH6uTvcbvy`) and inside the recreated Dockerized managed-dev poller image (`sesn_01BdpvdhXf1VwMAhqEWxEoSg`), both returning the two submitted/ungraded beta rows.
- Live Telegram outbound to the beta thread was smoke-tested through `.env.managed-dev`; one inbound beta-thread message was handled by the Managed Agents path before the poller was moved into the current Docker container.
- No automated coverage yet for managed-session event history beyond the local store or idle/termination policy.
- No dashboard health coverage yet for Managed Agents bridge/session status.
- OpenClaw-specific coverage is legacy rollback-only; do not expand it unless OpenClaw is explicitly revived.

Performance and reliability
- No load or soak tests.
- Network failure handling not stress tested.
- Restore drill validates snapshot integrity and SQLite bundle completeness, but not full in-place runtime rollback.
- Scheduled-task execution health is monitored via freshness status, not integration tests.

## Near-term additions (recommended)
- Add a Telegram E2E test harness that runs against a test bot and test chat.
- Add a reminder delivery integration test using a fake clock.
- Add a live scrape smoke test behind a feature flag.
