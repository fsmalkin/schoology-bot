# Test Coverage and Gaps

This document summarizes current test coverage and the known gaps.

## Current report command

`tests/current_summary.test.js` covers current missing/submitted classification,
exclusion of saved manual annotations and reminders, complete versus partial
empty snapshots, stale/future timestamps, invalid row/origin/timezone inputs,
safe same-origin links and duplicate/conflicting records. Actual CLI stdin/file
workflows run with configuration, database, scraper, Telegram and AI imports
denied. A legacy-command negative control proves the denial guard is exercised.
The file workflow verifies its input and neighboring synthetic saved state stay
unchanged; malformed input and unsupported/default/send modes fail explicitly.

These checks use synthetic records. They do not establish current Schoology
authentication, reader coverage, credential/bot/chat identity, phone delivery
or restoration of original saved history. `complete` is supplied by the reader
and must be independently grounded in the live view.

## One-time current report delivery

`tests/current_telegram_delivery.test.js` executes the actual PowerShell operator
preparation and imports the actual sender functions for provider-free tests.
Its adapters replace only credential/provider access and the expiry-test clock.
The existing Node formatter still runs as a child process on real synthetic
input files. PowerShell 7 is required rather than silently skipping the lane.

Controls cover exact bot and private-recipient binding, refusal of the sender
as recipient, reviewed payload hash, stale/oversized input, original ISO offset
preservation, expiry during metadata verification, missing credentials, rate
limit metadata, durable before-send reservation, an ambiguous existing receipt,
same-operation and same-payload duplicate suppression, HTTP refusal, timeout,
wrong returned text/chat, and no secret/report/error output. A complete mocked
workflow validates the actual receipt written before the one send attempt.
The operator has no default send and no token argument or export lifecycle.

Group controls run the real offline `pwsh -File` preparation with comma-separated
human IDs and test the actual sender functions with mocked metadata. They cover
explicit three-member audience/hash binding, member count and a final count
recheck, exact bot/human identities and roles, strict membership/permission
booleans, refusal of other bots and unqualified types, metadata failure and full
retry delays, expiry, exact returned group receipt and one send after durable
reservation. A disabled count guard turns the expanded-group attack into a
send, proving that refusal seam matters. Duplicate controls retain the same
effect claim despite changed audience, username, SID or operation name.

Transport controls verify one shared client across the complete private/group
workflow and cleanup on success and failure. Typed timeout cases at the initial
count, member lookup and final count preserve the exact failed stage, clear an
earlier HTTP 200, retain the last completed request count and emit type names
without the token-bearing exception message. Send timeout remains consumed and
cannot retry. These 67 sender cases plus 10 formatter cases pass locally.
The full local suite passes320 tests (314 pass/0 fail/6 platform or live skips)
with the same installed-Chrome settings as CI. The initial local run's11 browser
launch failures are retained; it used an absent bundled browser. No new install
or live provider test was needed for the source checks.

These tests use synthetic credentials and provider responses. They do not prove
the production credential adapter, current account/recipient, actual Telegram
delivery, phone acceptance or restored original runtime. Those require their
separately authorized live evidence. Full backend/reminder acceptance remains
open, and these tests do not activate it.

## Coverage summary

Unit tests
- DB schema migrations and CRUD for tasks/reminders/notes.
- Legacy reminder -> task migration and recurrence column migration.
- Status normalization and auto-ignore rules.
- Summary builder (actionable vs pending, plus local due-category fields for overdue/today/upcoming/undated assignments).
- Readable message formatter (Do Now/Soon/Waiting routing, future-due assignment placement, status wording, links, caps).
- Reminder assumption inference (cadence/time defaults and unsupported cadence fallback).
- Reminder normalization edge-cases (model-supplied time override, unsupported-cadence warning when recurrence is pre-normalized, and date-cue preservation while defaulting time).
- Refresh login-failure messaging when `SCHOLOGY_IDP` is already configured (avoids redundant provider prompts).
- Schoology auth flow coverage for Microsoft/BCPS keep-signed-in handling, remote-auth SAML handoff, BCPS local credential forms, native Schoology fallback, explicit saved-credential rejection diagnostics, and usable Grades-page fallback when Schoology keeps Playwright navigation waiting after the page renders.
- Login-failure Telegram alert throttling (first alert, cooldown suppression, changed-error resend, post-success resend).
- Assignment identity canonicalization (`assignment:<id>`) and legacy-key merge behavior.
- Assignment identity migration v6 (backfill `assignment_id`, dedupe by ID, and reference relink for notes/tasks).
- Chat-memory persistence, message-style persistence, and resolved-assignment reminder cleanup helpers.
- Short-lived conversation context persistence for recent displayed assignment lists, just-created issues, expiry cleanup, prompt injection, and context-aware numbered status updates.
- Schoology scraper title fallback for rows that have visible text but no assignment link (`Note: This material is not available within Schoology` pattern).
- Schoology scraper conflict handling for MUA/external-tool-link rows (score beats Missing badge, detail-page fallback for ambiguous rows, capped fallback volume).
- Optional Schoology browser selection covers the unchanged headless Chromium default and explicit SDK channel selection. Tests verify nonsecret configuration capture and rejection of unsupported channels before browser startup. Scraper and mock-login fixtures can select installed Chrome through `SCHOLOGY_BROWSER_CHANNEL`; existing assertions remain unchanged and mock-login pages abort unmatched network routes.
- Offline GitHub CI prepares the fake database directory and selects preinstalled Chrome for scraper and mock-login fixtures. An empty Chrome page evaluation and browser close precede the existing full offline test command. Dashboard fixtures use the same explicit browser setting; a rejected explicit channel fails instead of skipping. The existing missing-default-browser skip remains available when no channel is set. Live tests remain skipped by `SKIP_LIVE_TESTS=1`.
- Beta drawer tests preserve typed reminder fields through view switches, including two transitions in one task before an animation frame, and through timer-driven health polling. Snapshot values are restored when the drawer is replaced. Console-health failures include their native source URL; no errors are excluded from the check.
- Dashboard server tests require an empty204 response for the browser's GET/favicon.ico request, including a query variant. Unknown asset requests and POST/favicon.ico retain404 responses; the UI console checks still reject any resource errors.
- Submitted assignment handling: scraper coverage for Schoology grade-pending/dropbox icon hidden text, exact `Submitted` missing-feed rows, manual `Submitted` waiting-summary routing, DB auto-file behavior, and direct `submitted_awaiting_grade` assignment queries.
- Assignment list filtering verifies both flat and bucketed missing-list outputs honor ignored/pending visibility flags, keeping already-handled rows out of default agent-visible buckets.
- Dashboard health/data builders (heartbeat + snapshot assembly).
- Dashboard parent-home and schoolwork data builders (home section classification, local due-category routing, exact `Submitted` missing-feed rows in Waiting, parent-facing labels, assignment notes preview, reminder summary, task-only filtering, and raw-text title fallback when stored titles are blank).
- Dashboard read models for `Will complete in class` and MUA display-title expansion.
- Dashboard browser smoke coverage for click-to-open cards, the minimal card surface, collapsed drawer sections, explicit assignment status saves, long-running Schoology refresh busy/success feedback, backdrop/escape close behavior, and bulk-mode reveal.
- Beta dashboard client-state safeguards in `beta_dashboard.js` (draft-preserving rerenders, focus-return fallback when cards move buckets, and safer `Submitted` partial-failure handling) are covered through dedicated browser smoke and regression scenarios.
- Time parsing and timezone formatting (local labels, shorthand, and local-date due classification).
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
- Story suite runner (`scripts/run_agentic_story_suite.mjs`) executes scripted parent requests through `runChatMessage`.
- Story suite runner now routes through `runChatMessage`, so it can exercise the Managed Agents bridge when that runtime is selected by env.
- Story suite runner uses deterministic `AGENTIC_STORY_NOW` for reminder/date parsing in both legacy and Managed Agents runtime paths.
- Story suite includes a required submitted-but-ungraded icon-query story (`S9`) that must call `list_assignments` with `status=submitted_awaiting_grade`, include ignored rows, and prevent false empty/all-scored claims.
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
  - `npm run stories:run`
  - `npm run stories:judge`
- Managed Agents dev parity artifacts are the runtime release gate. `stories:judge` must run after `stories:run` completes because it consumes the completed artifact directory.
- Recovery/operations scripts:
  - `powershell -ExecutionPolicy Bypass -File scripts/start_schoology_stacks.ps1 -RuntimeMode docker`
  - `powershell -ExecutionPolicy Bypass -File scripts/create_schoology_pre_cutover_snapshot.ps1`
  - `powershell -ExecutionPolicy Bypass -File scripts/backup_schoology_state.ps1 -RuntimeMode docker`
  - `powershell -ExecutionPolicy Bypass -File scripts/run_schoology_restore_drill.ps1 -Source local`
  - `powershell -ExecutionPolicy Bypass -File scripts/restore_schoology_state.ps1 -RuntimeMode docker -Source local -Snapshot latest`
  - `powershell -ExecutionPolicy Bypass -File scripts/register_schoology_tasks.ps1 -RuntimeMode docker -RunAsPassword "<password>"`
- Restore drill coverage verifies the prod DB bundle plus gitignored runtime recovery files, including `data/beta/agent.runtime.db`.

## Gaps and risks

Schoology scraping (live)
- No automated live Schoology login/scrape tests.
- Playwright flow can regress if Schoology UI changes.

Telegram end-to-end
- Unit coverage verifies Telegram forum-topic/thread option normalization and per-thread target keys.
- `tests/telegram_kernel_lock.test.js` uses the real entrypoint with synthetic storage and fake external I/O in separate Linux PID namespaces, each with local PID1. Required CI enables `TELEGRAM_PID_NAMESPACE_TEST=1`: a live and paused owner must exclude a contender, an actual owned SIGKILL leaves metadata but permits one restart, and a guard-disabled mutant must fail the refusal instrument. This control is skipped when not enabled and is not Linux acceptance evidence from a Windows skip.
- Linux uses a nonblocking kernel lease on the permanent `telegram_agent.lock.lease` inode through the free util-linux tool declared in Docker. Never unlink or replace that lease file. Legacy or foreign-platform PID metadata requires verified owner recovery; neither namespace-local PID checks nor a new guard establishes absence of an old unguarded process. Original-data/runtime acceptance remains separate.
- `tests/telegram_agent_startup.test.js` evaluates the actual Telegram entrypoint, runtime dispatcher and pure message helpers with synthetic saved-state bytes and mocked Telegram, managed-backend and database imports. Twenty-four cases cover ownership before polling, denied or uncertain access, invalid lock/PID data, exclusive claims, stale PID recovery, same-PID restart, live same-PID Linux lease contention, missing or uncertain kernel locking, exact device/inode identity, legacy or foreign-platform refusal, constructor failure and ownership-safe shutdown. Linux lease ownership remains held until process termination once a polling client exists. Normal routing preserves the allowed chat/topic and ignores unauthorized, bot and duplicate input. No real account, SDK, school records or Telegram message is used.
- The short acquisition claim serializes stale-lock recovery. If a process dies during acquisition, its abandoned `.acquire` claim must be investigated and removed only after verifying that no owner remains; startup deliberately refuses to overwrite an uncertain claim.
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
- Config parsing/validation, chat-to-session mapping, and managed event persistence are covered by `tests/managed_agent_sessions.test.js`.
- Secret-file config loading is covered by `tests/config_secret_files.test.js`, including direct env precedence, empty direct env fallback to `*_FILE`, missing-file fallback, and file-backed Managed Agents API keys.
- Migration coverage verifies `managed_agent_sessions` and `managed_agent_events` creation in `tests/migrations.test.js`.
- Mock Managed Agents bridge coverage in `tests/managed_agent_bridge.test.js` verifies session creation/reuse, memory store resource attachment, stale definition revision replacement, idle-session reset before reuse, heartbeat/event-log writes with secret-looking values redacted, bounded local retry context for `try again` after stream failure and session reset, Telegram text event send, assistant text collection, local custom Schoology tool result handling, deterministic date-filtered bulk status updates, speculative pre-tool assistant text clearing after tool execution, repeated action-id dedupe before local tool execution, unsupported custom tool errors, web and memory file built-in confirmation allow-listing, unsupported built-in denial, kid-safe input/output blocking, deterministic invalid-arg errors, bounded large result payloads, and tool-round limits.
- `tests/managed_agent_status.test.js` verifies idle-policy decisions, proactive idle-sweep alert data, event metadata/value redaction, repeated tool-error alerting, and Managed Agents dashboard status/alert presentation.
- `tests/dashboard_data.test.js` verifies dashboard health snapshots include Managed Agents bridge service/session/event status when the managed runtime is active and can surface the existing managed-dev beta runtime from `data/beta/agent.runtime.db`.
- `tests/dashboard_ui_smoke.test.js` verifies the Admin panel renders Managed Agents session/event/alert details and folds Managed Agents alerts into the global status dot.
- `tests/managed_agent_tools.test.js` verifies exported Managed Agents custom tool definitions cover the current Schoology tool surface.
- `tests/managed_agent_definitions.test.js` verifies the Managed Agents system prompt keeps the reminder-default policy needed by parity stories, routes submitted/ungraded questions through the submitted-status filter, resolves numbered-list bug references against short-lived current-thread context, routes broad due-date status changes through `bulk_update_assignments_by_filter`, enables only `web_search`/`web_fetch` plus memory file tools from the built-in agent toolset, keeps `bash` disabled, and includes memory guardrails against storing secrets, raw grades, full assignment lists, private student records, unsafe content, or verbatim fetched/web content.
- `tests/conversation_context.test.js` verifies displayed-list capture, issue-context capture, TTL expiry, prompt formatting, and context-aware numbered status updates.
- `tests/kid_safe_content_filter.test.js` verifies ordinary Schoology and safe web prompts pass while adult, violent, dangerous, cyber-abuse, harassment, and self-harm requests are blocked or redirected.
- Live Managed Agents parity now has artifacts from the story suite and judge (`20260527-052502`) using Claude sessions and local Schoology custom tools, including the submitted/ungraded icon-query story.
- A broader isolated live Managed Agents JTBD UAT passed with Claude session `sesn_01HpAfEZH9345jZQC5Fh9dbB`, covering seeded assignment listing, manual status update, assignment note, assignment-linked reminder, standalone recurring reminder, correction/update, unsupported monthly fallback, daily summary, and due-reminder drain.
- Beta Schoology auth was refreshed after stale storage was confirmed, and a live Managed Agents dev repro passed with Claude session `sesn_018Gc6shAGPFyDd6DGXhLSw9`: `refresh_schoology` succeeded against real Schoology data, then `list_assignments` returned zero actionable, pending, or ignored missing assignments.
- A live Managed Agents submitted/ungraded icon-query smoke passed with Claude session `sesn_017YiTWYQ4FT6unZ6DLXaMp8`, calling `list_assignments` with `status=submitted_awaiting_grade` and returning the two historical beta rows marked by Schoology's hidden submitted/ungraded text.
- After the bridge speculative-text fix, live beta-data Managed Agents submitted/ungraded smokes passed locally (`sesn_01LaHRC29pzSYAsH6uTvcbvy`) and inside the recreated Dockerized managed-dev poller image (`sesn_01BdpvdhXf1VwMAhqEWxEoSg`), both returning the two submitted/ungraded beta rows.
- Live beta auth refresh on 2026-05-28 now succeeds from the Dockerized managed-dev poller after preferring the `Login with your BCPS Account` provider path and waiting for the Microsoft credential form; beta storage/state refreshed at 2026-05-28 09:07 ET with 26 missing assignments found.
- Dev cloud agent version `5` enables only `web_search`/`web_fetch` from the Managed Agents built-in toolset. Live smoke `sesn_01XemzqCm6qiasnsqKYScfvA` returned the official BCPS calendar link through web search, unsafe input was blocked before Claude session creation, and the recreated Dockerized managed-dev poller still routed submitted/ungraded Schoology questions through `list_assignments` with `status=submitted_awaiting_grade` in session `sesn_01Uw4f9QtyPcvkTeKJxdPFCW`.
- Dev cloud agent version `7` attaches Claude managed memory store `memstore_01F4pmYqg2GRep72inSfK2zi` to new dev sessions and enables the memory file tools `read`, `write`, `edit`, `glob`, and `grep` while keeping `bash` disabled. Live memory smoke wrote `/preferences/parent_preferences.md` in session `sesn_01Xfm4iyQmigceMYcF9kDhBg`, listed the memory store contents, recalled the preference from fresh session `sesn_015nNuouPRitk1mvHgPWLF7e`, and recalled it again from the recreated Dockerized managed-dev poller in session `sesn_015dSmmxjCgtVVTei98gVkDF`.
- Dev cloud agent version `8` adds deterministic date-filtered bulk status routing for requests like "mark everything before 4/4 as no action needed." Unit coverage verifies no-action wording normalization, missing-assignment date filters, school-year shorthand-date correction, safety-cap no-write behavior, Managed Agents custom-tool schema exposure, and one-call Managed Agents bridge execution. Live copied-DB repro `sesn_01Bj1VcoqpqDHWerrf8iTs88` used the new tool and updated the 7 intended beta rows in one pass.
- Live Telegram outbound to the beta thread was smoke-tested through `.env.managed-dev`; one inbound beta-thread message was handled by the Managed Agents path before the poller was moved into the current Docker container.
- Managed-session event-history, idle reset policy, idle-sweep reset, metadata/value sanitization, and dashboard bridge/session status now have automated coverage. True remote Claude session termination remains local-reset-only until the Managed Agents API exposes or documents an explicit terminate/delete operation for sessions.
- Tracked-file secret leak scanning is covered by `npm run secrets:scan`, a local high-confidence scanner for OpenAI, Anthropic, GitHub, Telegram, and private-key block patterns.

Performance and reliability
- No load or soak tests.
- Network failure handling not stress tested.
- Restore drill validates snapshot integrity and SQLite bundle completeness, but not full in-place runtime rollback.
- Scheduled-task execution health relies on freshness status; integration coverage remains open.

## Near-term additions (recommended)
- Add a Telegram E2E test harness that runs against a test bot and test chat.
- Add a reminder delivery integration test using a fake clock.
- Add a live scrape smoke test behind a feature flag.
