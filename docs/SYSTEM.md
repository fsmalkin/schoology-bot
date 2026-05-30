# System Reference

Purpose: single-page reference for how the Schoology bot works, how it runs, and where data lives.

## Services
- schoology (scheduler)
  - Runs cron jobs for scrape, summary send, and reminders.
- telegram-agent
  - Handles chat messages, tool routing, and responses.
- dashboard
  - Local health UI + JSON status endpoint for operations visibility.
- Claude Managed Agents bridge (dev implementation)
  - Target replacement runtime for agent chat in dev, then prod after parity gates.
  - Telegram inbound resumes managed sessions; Claude custom tool requests call local deterministic tools.
  - Dev agent enables only `web_search`/`web_fetch` built-ins for school-safe public reference lookups plus Claude memory file tools (`read`, `write`, `edit`, `glob`, `grep`) for the mounted memory store under `/mnt/memory`; `bash` remains disabled.
  - Claude managed memory is for durable preferences and operating lessons only. Schoology data still comes from deterministic local tools/SQLite and should not be copied into memory as raw grades, full assignment lists, or private student records.
  - Kid-safe input/output filtering blocks unsafe Telegram requests before model calls and suppresses unsafe final replies.
  - Session metadata stores the managed-agent definition revision; chats with stale revisions are forced onto a fresh Claude session.
  - Idle sessions are locally reset before reuse and swept by the managed Telegram poller when `MANAGED_AGENT_IDLE_TIMEOUT_MINUTES` is exceeded, preventing stale managed sessions from accumulating as active chat state.
  - Managed session metadata is not a transcript store. It carries only bounded local retry context for the last failed user request so `try again` can survive stream failures and forced session resets.
  - The bridge writes `managed-agent-bridge.heartbeat.json` plus sanitized `managed_agent_events` rows for session lifecycle, tool results, kid-safety blocks, turn completion, and turn errors. Secret-like keys and values are redacted before local event/heartbeat persistence.
  - Implemented entrypoints: `src/agent_runtime.js`, `src/managed_agent_bridge.js`, `src/managed_agent_client.js`.
  - Tracking: [#25](https://github.com/fsmalkin/schoology-bot/issues/25), [Managed Agents migration doc](managed-agents/README.md), [FSM Engineering Board](https://github.com/users/fsmalkin/projects/3).

## Core flows
1) Scrape
   - Playwright login -> grades page -> parse missing assignments.
   - Treat title text like `(Graded: 1/10)` as descriptive only; do not use it by itself as proof that the current student's item is graded or resolved.
   - If Schoology renders a gradebook row without an assignment link, fall back to the visible row title/raw row text so dashboard and reminder flows still show a usable title.
   - For ambiguous external-tool-link rows, use score/submitted signals before generic Missing badges and fall back to the assignment detail page only for conflicting status evidence.
   - Updates state.json and syncs into SQLite.
2) Summary send
   - Builds DB-backed summary (actionable + pending; archived hidden by default).
   - Submitted-but-ungraded Schoology rows are auto-archived.
   - Sends via Telegram (agentic if OpenAI key is set).
3) Reminders
   - Pending tasks due now trigger Telegram reminders.
   - One-time reminders roll over by 24h if not completed.
   - Recurring reminders are expanded by cadence (`daily`, `weekdays`, `weekly`) in reminder runner logic.
   - Assignment-linked reminders with `auto_cancel_on_resolve=1` are auto-completed when the assignment resolves, is auto-ignored, or is submitted-awaiting-grade.
4) Agent chat
   - `telegram-agent` calls `runChatMessage`, which selects legacy OpenAI Responses or Claude Managed Agents from config.
   - Kid-safe guardrails block unsafe/adult/graphic/dangerous requests before agent calls and replace unsafe final text before Telegram delivery.
   - Capability gate checks for unsupported requests and proposes nearest supported fallback.
   - Planner selects tools, executes, then composes final message.
   - Pending actions, chat memory snapshots, and message style preferences are stored per chat for multi-step confirmations and long-thread continuity.
   - Reminder writes are agent-mediated with proactive assumptions + post-create confirmation:
     - missing recurring cadence defaults to weekdays on explicit recurring asks,
     - missing recurring time defaults to 7:00 AM / 4:30 PM / 9:00 PM ET by cue type,
     - unsupported cadence falls back to weekly with explicit warning.
   - Broad local status writes, such as marking everything before a due date as no action needed, route through a deterministic filtered bulk tool with missing-assignment defaults and a safety cap.
   - User-facing follow-up text expands `MUA` to `Mid-Unit Assessment`, can switch between `compact` and `plain_language`, and includes saved note/reminder context when available.
5) Dashboard
   - `Home` reads SQLite to build a parent-first after-school plan with clickable assignment and follow-up cards.
   - `All Schoolwork` reads SQLite for card-based assignment management, opt-in bulk status updates, notes, and reminders.
   - Manual assignment statuses include `Will complete in class` as a pending-but-lower-urgency state.
   - `Admin` reads state.json, SQLite, and heartbeat files for service freshness + assignment/follow-up health.

## Data and logs
- data/state.json
  - Last scrape timestamps and raw assignment cache.
- data/agent.db
  - SQLite for assignments, unified task/reminder records, notes, chat_state,
    chat_memory, `managed_agent_sessions`, and `managed_agent_events`.
  - `managed_agent_sessions` includes Claude session mapping plus bounded local
    retry metadata for the last failed Telegram request.
  - `managed_agent_events` stores sanitized bridge events for operations
    debugging without raw prompts or secret-bearing metadata fields. Secret-like
    values in summaries, errors, and metadata are redacted before persistence.
- data/beta/agent.runtime.db
  - Current managed-dev beta runtime DB for beta UAT.
- Claude managed memory store
  - Remote Claude memory store mounted into configured managed sessions under `/mnt/memory`.
  - Current dev store: `memstore_01F4pmYqg2GRep72inSfK2zi`.
  - Stores durable preferences and operating lessons only, not secrets or raw Schoology records.
- artifacts/beta-reset/*
  - Beta reset snapshots and parity report artifacts.
- artifacts/agentic-story-suite/*
  - Story transcripts, tool snapshots, and judge evidence JSON artifacts.
- data/bugs.log
  - Local bug/feature drafts (JSON lines).
- data/agent.log
  - Telegram agent log (chat activity).
- data/health/*.heartbeat.json
  - Service heartbeat files for scheduler/agent/dashboard and the Managed
    Agents bridge when that runtime handles turns.

## Configuration (env)
Key settings:
- SCHOLOGY_USERNAME / SCHOLOGY_PASSWORD
- SCHOLOGY_LOGIN_ATTEMPTS / SCHOLOGY_LOGIN_RETRY_DELAY_MS
- LOGIN_DIAGNOSTIC_PATH
- TIMEZONE (defaults to America/New_York)
- SCRAPE_CRON / SEND_CRON / REMINDER_CRON
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS
- OPENAI_API_KEY / OPENAI_MODEL / OPENAI_REASONING_EFFORT
- MANAGED_AGENTS_ENABLED / MANAGED_AGENTS_ENV
- ANTHROPIC_API_KEY / CLAUDE_API_KEY
- CLAUDE_MANAGED_AGENT_ID / CLAUDE_MANAGED_ENVIRONMENT_ID / CLAUDE_MANAGED_AGENTS_BETA
- CLAUDE_MANAGED_MEMORY_STORE_ID / MANAGED_AGENT_MEMORY_STORE_ID
- MANAGED_AGENT_MEMORY_STORE_ACCESS / MANAGED_AGENT_MEMORY_STORE_INSTRUCTIONS
- MANAGED_AGENT_SESSION_TTL_MINUTES / MANAGED_AGENT_IDLE_TIMEOUT_MINUTES / MANAGED_AGENT_STREAM_TIMEOUT_MS / MANAGED_AGENT_MAX_TOOL_ROUNDS / MANAGED_AGENT_TOOL_RESULT_MAX_CHARS / MANAGED_AGENT_SESSION_NAMESPACE
- AUTO_IGNORE_* and AUTO_UPCOMING_*
- LIVE_CHECK_* (disabled by default)

Secrets can be supplied by direct env values or by `<NAME>_FILE` paths. Direct
env values win. Production deployment should use Windows Credential Manager as
the source of truth, export Docker secret files under `data/secrets/prod/`, and
load `data/runtime/prod.env`; see `docs/SECRETS.md`.

## Commands
- Run scheduler: `npm start`
- One-off scrape: `npm run scrape`
- One-off summary: `npm run send`
- Telegram agent: `npm run agent:telegram`
- Dashboard: `npm run dashboard`
- Interactive login: `npm run login:interactive`
- Tests: `npm test`
- Agentic stories: `npm run stories:run`
- Agentic judge: `npm run stories:judge`

## Runtime
Primary runtime (unattended):
- Docker Compose only.
- Start command: `powershell -ExecutionPolicy Bypass -File scripts/start_schoology_stacks.ps1 -RuntimeMode docker`.
- Startup waits for Docker engine readiness before compose actions and retries until timeout with diagnostics.
- Managed Agents prod cutover uses `docker-compose.managed-prod.yml` with
  Docker secret files generated from Windows Credential Manager.
- The current committed Docker prod runtime remains rollback by starting without
  the managed-prod override.

Scheduled startup mode:
- Register tasks with stored-password logon mode (`/RU` + `/RP`) so jobs run while logged off.
- Command: `powershell -ExecutionPolicy Bypass -File scripts/register_schoology_tasks.ps1 -RuntimeMode docker -RunAsUser "$env:USERNAME" -RunAsPassword "<password>"`
- Post-registration assertions enforce task logon type `Password`.

Recovery and DR:
- `powershell -ExecutionPolicy Bypass -File scripts/start_schoology_stacks.ps1 -RuntimeMode docker`
- `docker compose -f docker-compose.yml -f docker-compose.managed-prod.yml -p schoology-prod up -d --build`
- `powershell -ExecutionPolicy Bypass -File scripts/backup_schoology_state.ps1 -RuntimeMode docker`
- `powershell -ExecutionPolicy Bypass -File scripts/backup_schoology_catalog_github.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/run_schoology_restore_drill.ps1 -Source local`
- `powershell -ExecutionPolicy Bypass -File scripts/restore_schoology_state.ps1 -RuntimeMode docker -Source local -Snapshot latest`
- `powershell -ExecutionPolicy Bypass -File scripts/check_schoology_backup_freshness.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/register_schoology_tasks.ps1 -RuntimeMode docker -RunAsUser "$env:USERNAME" -RunAsPassword "<password>"`

## Decision + Outcome
Decision:
- Standardize unattended Schoology runtime on Docker only.
- Standardize scheduled tasks on password logon mode (non-interactive).

Outcome:
- Single runtime path reduces startup drift and troubleshooting branches.
- Tasks execute post-boot/logged-off without requiring interactive desktop logon.
- Login failures now produce diagnostic artifacts and retry before alerting.
Fallback:
- If unattended task logon fails, run `scripts/start_schoology_stacks.ps1 -RuntimeMode docker` manually, then re-register tasks with a verified password.

## Known constraints
- Recurring cadence is limited to `daily`, `weekdays`, `weekly`.
- Schoology login is session-based; interactive login required when session expires.
- Schoology title text can be ambiguous: `(Graded: <date>)` may reflect assignment-level/class-level grading context, not the current student's final status.
- Production Telegram bot should be single-instance to avoid duplicate messages.
- Release gate for agent runtime changes is mandatory before UAT:
  - Managed Agents dev run against copied prod memory/state,
  - agentic story suite,
  - one judge run with evidence artifact,
  - explicit rollback command and cost/idle monitoring.
