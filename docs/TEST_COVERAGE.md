# Test Coverage and Gaps

## Current-term MCP request/response source

`npm run test:chatgpt-mcp` exercises the actual Web API handler and accepted
summary adapter using fabricated requests and snapshots. It covers the pinned
MCP2025-11-25 initialization/profile, discovery, ping, tool calls, notification
acknowledgments, JSON-RPC errors, missing/denied host grants, forged identity
headers/metadata, invalid arguments, stale/unqualified/error sources, exact
Origin checks, methods/media types, malformed UTF-8 and JSON, bounded streams,
stream cleanup and bounded result envelopes. A provider declaring another
caller, student or period is refused, and principal/boolean-only grants never
access a provider. Two concurrent synthetic callers
receive distinct readers; a later denial cannot reuse a previous grant.

The fixtures supply Request, Response, Headers, URL, text encoders/decoders,
ReadableStream and Uint8Array explicitly. A child imports and calls the actual
handler under the existing no-I/O/service guard. No listener is opened, and
no original student data, session, real token or provider is used. All22
handler tests and17 adapter tests pass together (39/39, zero skipped); the ten unchanged current-summary
regressions retain their earlier passing evidence.

These tests establish Node request/response behavior, not complete protocol
certification, observed Schoology subject/period binding, actual Sites identity/OAuth, Worker/browser build compatibility,
rate limiting, request deadlines, a qualified live reader or phone delivery.
The separate Builder bundle/VM qualification is not replayed by these checks.

## Current-term ChatGPT adapter source

`npm run test:chatgpt-adapter` passes 17 fabricated-input tests for the actual
`get_current_term_summary` adapter. The cases cover no-argument enforcement
before reader invocation, absent/unqualified input, freshness after an async
read, malformed/oversized fields, submitted-work exclusion, duplicates,
complete versus partial empty results, approved-field projection, link cleanup
and unchanged frozen input. Responses stay within 50 rows and 48 KiB; text and
structured output contain the same selected items and disclose omissions.

Guarded child imports exercise both ready and unavailable calls, while 21
negative controls refuse file, network, process, model, database and service
imports. This is an import-graph check, not a sandbox for arbitrary injected
readers. The first run passed 15 cases and failed two guard setups because the
Windows loader argument was a drive path; using its file URL fixed those cases
without changing the denials. Existing current-summary regression tests also
pass 10/10. No original data, Schoology session, credential or server is used.

The private source package depends on this whole checkout. It is not an
installable plugin or standalone archive. Trusted subject/term declarations in
fixtures do not prove current-semester membership, live authorization, hosted
compatibility, target account/mobile access or actual consumer delivery.

## Docker context environment exclusions

`.dockerignore` excludes `.env` and `.env.*`, with exact exceptions for the
tracked `.env.example` and `.env.beta.example` setup templates. All prior
rules, including `data/`, remain unchanged; the Dockerfile is unchanged.

A one-time source check used 10 fabricated root environment filenames. It
covered the four names declared by `Get-DefaultSourceFiles`, four additional
variant/backup names, and both template exceptions. The old rules missed the
three declared variants; the new rules matched all 10 expected outcomes.
The check modeled only literal root names, `.env.*` and exact negation order,
using the documented [Docker ignore syntax](https://docs.docker.com/build/concepts/context/#dockerignore-files).
It did not read environment files or run Docker/BuildKit, and does not prove
full matching-engine behavior, a built image or the presence/absence of any
real secret file. Required offline repository CI remains separate evidence.

## CLI configured runtime

`tests/agent_cli.test.js` launches the actual `src/agent_cli.js` subprocess with
minimal environment variables, an empty selected dotenv, fabricated responses,
synthetic state and in-memory SQLite. It checks both managed selectors, joined
positional arguments, `local-cli` identity, stdout, usage/error exit1, one exact
tool-result correlation, refusal bookkeeping, provider limits, transport/JSON
errors and incomplete streams without fallback or automatic retry.

The selected legacy route uses a controlled fake target before its real body
can execute. Unselected legacy entry, model/Telegram construction, service
imports/startup, private/original-store reads, writes outside synthetic storage,
network and process launches are guarded. Unselected Playwright imports use a
deny-only browser target so browser platform discovery does not run in the CLI.
Negative controls exercise network, dotenv, `_FILE`, legacy and browser denials.
Before the CLI-to-router correction,
14 of the21 cases failed at the unselected legacy guard; the same21 passed
afterward. The first Linux CI recorded18 guard failures with two denied private
reads per subprocess; eager browser initialization was the candidate cause.
The fixture now blocks that dependency before import and adds a browser control;
the denied file permissions remain unchanged. This does not establish live authentication, legacy model behavior,
provider acceptance, a running service or student-data access.

## Managed Agents stream contract

`tests/managed_agent_client.test.js` exercises fabricated wire bytes through
the actual SSE parser. It covers missing versus explicit JSON discriminators,
preserved event metadata, comments, trailing frames, multiline JSON and UTF-8
across every chunk size for LF, CRLF and CR. Error frames and malformed known
events fail without their raw payload appearing in the error; reader cleanup
and the existing generic non-JSON fallback are also checked.

`tests/managed_agent_bridge.test.js` distinguishes natural `end_turn`, refusal,
budget and retry exhaustion, unknown reasons, termination and unconfirmed EOF.
It verifies completion/error/refusal records and heartbeat states, and no
automatic retry. A complete in-process wire fixture runs the real client,
parser, bridge and deterministic tool with an in-memory database: a CR-framed
custom tool request produces exactly one correlated result, then completes
only on `end_turn`. Error and malformed frames fail before a later completion.
Existing tool, safety, session reuse, deduplication and round-limit tests remain.

Local execution uses a minimal environment, an empty selected dotenv file,
synthetic storage, fake fetch responses and guards against network, original
data and other dotenv reads. These checks do not establish live authentication,
provider acceptance, original data recovery, unattended service health or new
retry/resume behavior.

## Offline Managed Agents rendering

`tests/managed_agent_render.test.js` runs the actual admin CLI for agent and
environment definitions in dev and prod. Import guards reject dotenv,
configuration, database and service modules; a preload observes and refuses
selected secret-file reads and blocks network calls. Separate negative
controls prove the dotenv and file-read guards are connected. Pre-refactor
definition hashes establish unchanged JSON output. A synthetic dotenv plus
mocked transport checks that actual API commands still resolve their selected
key/base URL/beta header, and a missing key still fails before transport.

These checks do not establish current provider-schema compatibility, an
installed key, original data access, a deployed agent or a functioning service.

## Claude-only native credential import

`tests/claude_key_import.test.js` executes the actual PowerShell7 importer
with an in-memory credential class and synthetic hidden-prompt input. It
covers one exact target and opaque readback, forbidden environment-file
access, a dry run with no prompts/store reads/writes, refused action/source/
optional/Force combinations, existing-key refusal, empty input, failed
readback without a second write, and unchanged five-key legacy import.
No real native credential store, secret, provider or paid model is exercised.
Actual encrypted installation and provider authentication remain separate.

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

Runtime selection gives each existing shell candidate a bounded 30-second
startup probe. A failed probe reports candidate number, elapsed time, exit,
signal and allowlisted error code; raw output and error messages are omitted.
`tests/powershell_runtime.test.js` covers delayed startup, timeout/fallback,
failed processes that print 7, missing/unsupported/malformed runtimes and
diagnostic redaction. All operator cases remain mandatory after selection.

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

The default request window is now 30 seconds, matching the separately admitted
settings used for one verified production report. An offline check of the actual
transport factory confirmed that bound, redirect refusal and the 64 KiB
response limit without credential or network access. All 77 existing operator
and formatter cases passed, including timeout, no-retry and audience controls. The earlier
report receipt is point-in-time delivery evidence; it does not establish phone
acceptance, recurring operation or recovery of original saved history.

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
