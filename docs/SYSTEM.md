# System Reference

Purpose: single-page reference for how the Schoology bot works, how it runs, and where data lives.

## Services
- schoology (scheduler)
  - Runs cron jobs for scrape, summary send, and reminders.
- telegram-agent
  - Handles chat messages, tool routing, and responses.
- dashboard
  - Local health UI + JSON status endpoint for operations visibility.
- schoology-tool-api (optional, OpenClaw beta)
  - Exposes tools for OpenClaw gateway.
- openclaw-gateway (optional, OpenClaw beta)
  - Handles Telegram chat and cron scheduler in one runtime.
- openclaw-cron-sync (optional, OpenClaw beta)
  - Reconciles managed cron jobs on startup (scrape, summary, due reminders).
- openclaw-gateway-monitor (optional, OpenClaw beta)
  - Writes gateway heartbeat for dashboard visibility.
  - UI and tool router for OpenClaw evaluations.

## Core flows
1) Scrape
   - Playwright login -> grades page -> parse missing assignments.
   - Updates state.json and syncs into SQLite.
2) Summary send
   - Builds DB-backed summary (actionable + pending; archived hidden by default).
   - Submitted-but-ungraded Schoology rows are auto-archived.
   - Sends via Telegram (agentic if OpenAI key is set).
3) Reminders
   - Pending tasks due now trigger Telegram reminders.
   - One-time reminders roll over by 24h if not completed.
   - Recurring reminders are expanded by cadence (`daily`, `weekdays`, `weekly`) in reminder runner logic.
4) Agent chat
   - Capability gate checks for unsupported requests and proposes nearest supported fallback.
   - Planner selects tools, executes, then composes final message.
   - Pending actions stored per chat for multi-step confirmations.
   - Reminder writes are agent-mediated with proactive assumptions + post-create confirmation:
     - missing recurring cadence defaults to weekdays on explicit recurring asks,
     - missing recurring time defaults to 7:00 AM / 4:30 PM / 9:00 PM ET by cue type,
     - unsupported cadence falls back to weekly with explicit warning.
5) Dashboard
   - Reads state.json, SQLite, and heartbeat files.
   - Shows service freshness + assignment/task health at a glance.

## Data and logs
- data/state.json
  - Last scrape timestamps and raw assignment cache.
- data/agent.db
  - SQLite for assignments, unified task/reminder records, notes, chat_state.
- artifacts/beta-reset/*
  - Beta reset snapshots and parity report artifacts.
- artifacts/agentic-story-suite/*
  - Story transcripts, tool snapshots, and judge evidence JSON artifacts.
- data/bugs.log
  - Local bug/feature drafts (JSON lines).
- data/agent.log
  - Telegram agent log (chat activity).
- data/health/*.heartbeat.json
  - Service heartbeat files for scheduler/agent/dashboard.

## Configuration (env)
Key settings:
- SCHOLOGY_USERNAME / SCHOLOGY_PASSWORD
- TIMEZONE (defaults to America/New_York)
- SCRAPE_CRON / SEND_CRON / REMINDER_CRON
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS
- OPENAI_API_KEY / OPENAI_MODEL / OPENAI_REASONING_EFFORT
- AUTO_IGNORE_* and AUTO_UPCOMING_*
- LIVE_CHECK_* (disabled by default)

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
- Beta reset from prod memory: `npm run beta:reset-memory`

## Runtime
Primary runtime:
- WSL2 + systemd (`schoology.target`) installed via `scripts/install_schoology_native_services.ps1`.
- Native orchestration command: `powershell -ExecutionPolicy Bypass -File scripts/start_schoology_stacks.ps1 -RuntimeMode native`.
- Native services:
  - `schoology-prod-scheduler.service`
  - `schoology-prod-telegram.service`
  - `schoology-prod-dashboard.service`
  - `schoology-beta-tool-api.service`
  - `schoology-beta-gateway.service`
  - `schoology-beta-monitor.service`
  - `schoology-beta-dashboard.service`
  - `schoology-beta-cron-sync.timer` (`OnBootSec=90s`, `OnUnitActiveSec=6h`)

Fallback runtime:
- Docker remains supported via `scripts/start_schoology_stacks.ps1 -RuntimeMode docker`.
- Legacy beta (`docker-compose.beta.yml`) is deprecated for routine operations.

Recovery and DR:
- `powershell -ExecutionPolicy Bypass -File scripts/install_schoology_native_services.ps1 -EnableNow`
- `powershell -ExecutionPolicy Bypass -File scripts/start_schoology_stacks.ps1 -RuntimeMode native`
- `powershell -ExecutionPolicy Bypass -File scripts/create_schoology_pre_cutover_snapshot.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/backup_schoology_state.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/backup_schoology_catalog_github.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/run_schoology_restore_drill.ps1 -Source local`
- `powershell -ExecutionPolicy Bypass -File scripts/restore_schoology_state.ps1 -Source local -Snapshot latest`
- `powershell -ExecutionPolicy Bypass -File scripts/check_schoology_backup_freshness.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/register_schoology_tasks.ps1`

## Known constraints
- Recurring cadence is limited to `daily`, `weekdays`, `weekly`.
- Schoology login is session-based; interactive login required when session expires.
- Production Telegram bot should be single-instance to avoid duplicate messages.
- Release gate for reminder-scope changes is mandatory before UAT:
  - beta reset from prod memory,
  - agentic story suite,
  - one GPT-5.2 judge run with evidence artifact.
