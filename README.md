# Schoology Bot

A friendly, local-first Schoology assistant that logs in, finds missing assignments, sends a daily summary, and lets you chat with an agent to update statuses, add notes, schedule reminders, and manage tasks.

It runs on your machine today and is ready to move to a server later.

## What it does
- Scrapes Schoology grades and detects missing or incomplete work.
- Sends a daily summary via Telegram (SMS or email optional).
- Provides an agentic chat interface (GPT-5.2) to answer questions and update statuses.
- Stores history, notes, reminders, tasks, and chat context locally.

## Quick start (Docker unattended)
1. Copy `.env.example` to `.env` and fill in values.
2. Run `docker compose up -d --build`.
3. Check logs with `docker compose logs --tail 200`.

Note: Docker runs three services by default:
- `schoology` (scheduler for scrape/send/reminders)
- `telegram-agent` (chat agent)
- `dashboard` (local parent-first dashboard at `http://127.0.0.1:8787`)
- Optional profile: `dashboard-tailscale` (publishes dashboard on your tailnet domain)

## Supported runtime policy
- Unattended runtime is Docker-only.
- Scheduled startup tasks are registered with stored user password mode (non-interactive, works while logged off).
- Docker mode removes startup fallback artifacts to avoid native/runtime drift.

## Local quick commands (manual/debug only)
1. Run `npm install`.
2. Run `npm run scrape` (single scrape) or `npm run send` (single summary send).
3. Run `npm run login:interactive` when Schoology auth/session needs refresh.

## Uptime and Updates (Docker)
For higher uptime and safer updates, use Docker with auto-restart and health checks.

Common commands:
- Start or update: `docker compose up -d --build`
- Check health: `docker compose ps`
- Tail logs: `docker compose logs -f`
- Stop: `docker compose down`

## Windows task registration (non-interactive)
Register Schoology tasks under your current user with stored password logon mode:

`powershell -ExecutionPolicy Bypass -File scripts/register_schoology_tasks.ps1 -RuntimeMode docker -RunAsUser "$env:USERNAME" -RunAsPassword "<password>"`

Validation command:

`schtasks /Query /TN Schoology-StartStacks-OnBoot /V /FO LIST`

## Auto-Update (Optional)
There is no CI/CD pipeline by default. If you want the machine to pull `main`
and rebuild Docker automatically, use the script:

`scripts/auto_update.ps1`

Examples:
- Dry run: `powershell -ExecutionPolicy Bypass -File scripts/auto_update.ps1 -DryRun`
- Update main: `powershell -ExecutionPolicy Bypass -File scripts/auto_update.ps1 -Branch main`
- Skip tests: `powershell -ExecutionPolicy Bypass -File scripts/auto_update.ps1 -Branch main -SkipTests`

The script runs `npm test` by default with `SKIP_LIVE_TESTS=1`.
To run live OpenAI tests during update, add `-RunLiveTests`.

You can run this on a schedule via Windows Task Scheduler if desired.

## Run modes
- `npm run scrape` scrapes and updates local state.
- `npm run send` sends the latest summary.
- `npm run run-once` scrapes and sends immediately.
- `npm run agent:telegram` starts the Telegram agent (chat).
- `npm run agent:cli -- "What is missing today?"` runs a local chat query.
- `npm run dashboard` starts the local dashboard.

## Dashboard (Bookmark This)
Use the dashboard to manage work first and inspect runtime health second:
- URL: `http://127.0.0.1:8787`
- API: `http://127.0.0.1:8787/api/health`

What it shows:
- `Home`
  - A parent-first after-school plan with one dominant `Needs Attention Tonight` section, quieter `Waiting on School` and `Coming Up` sections, and a collapsed `Handled for Now`.
  - A compact summary ribbon for `Tonight`, `Waiting`, and `Next reminder`.
  - Mixed assignment and follow-up cards where the card itself opens a right-side review drawer.
- `All Schoolwork`
  - Search, one scope filter, a grouped list for `Needs attention` and `Waiting on school`, a collapsed `Handled for now` section, and opt-in bulk selection.
- `Admin`
  - Service heartbeat status, scrape/summary freshness, assignment/follow-up health counts, quick Docker commands, and docs pointers.

If you run with Docker Compose, the dashboard service starts automatically.
If you run locally without Docker, use `npm run dashboard`.

## Dashboard Over Tailscale (Optional)
Use this if you want the dashboard reachable from anywhere on your Tailscale network.

1. Set in `.env`:
   - `TAILSCALE_AUTH_KEY=tskey-...`
   - `TAILSCALE_DASHBOARD_HOSTNAME=schoology-dashboard` (or your preferred node name)
2. Start with Tailscale profile:
   - `docker compose --profile tailscale up -d --build`
3. Open:
   - `https://schoology-dashboard.<your-tailnet>.ts.net`
   - Or if you changed the hostname: `https://<TAILSCALE_DASHBOARD_HOSTNAME>.<your-tailnet>.ts.net`

Notes:
- Dashboard still remains local at `http://127.0.0.1:8787`.
- Tailnet access is controlled by your Tailscale ACLs.

## Data
- `data/state.json` stores assignment history and last run metadata.
- `data/storage.json` stores browser session state for faster logins.
- `data/agent.db` stores assignments, notes, reminders, tasks, and chat state.

## Debug
Set `DEBUG_DUMP=true` in `.env` to save a screenshot and HTML snapshot to `data/` on failures.
Login-failure alerts are rate-limited via `LOGIN_ALERT_COOLDOWN_MINUTES` (default `360`).
Login retry behavior is controlled by:
- `SCHOLOGY_LOGIN_ATTEMPTS` (default `2`)
- `SCHOLOGY_LOGIN_RETRY_DELAY_MS` (default `1500`)
- `LOGIN_DIAGNOSTIC_PATH` (default `data/login-diagnostic.json`)

## Interactive Login (First Time)
If the login flow changes or is protected by Microsoft, run:
- `npm run login:interactive`
Complete the login in the browser window, then press Enter in the terminal.
This saves `data/storage.json`, which is reused for scheduled runs.
If you are running in Docker, run the login command on your host (not inside the container) so the browser can open.

## Login IdP
If your district uses Microsoft/SSO, set `SCHOLOGY_IDP="microsoft"` in `.env`.
Other options: `local`, `azuread`, `schoology`, `adfs`. Default is `auto`.
If SSO requires selecting a school, set `SCHOLOGY_SSO_SCHOOL` (default is `Baltimore County Public Schools`).

## Telegram
Required `.env` values for Telegram:
- `DELIVERY_CHANNEL="telegram"`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_IDS` (comma-separated list of chat IDs)

How to get chat IDs:
1. Create a bot with BotFather and copy the bot token.
2. Send a message to your bot in Telegram.
3. Run `npm run telegram:updates` and copy the `chat_id` value.

## Agent (GPT-5.2)
Run a Telegram-based agent that can answer questions, update statuses, add notes, schedule reminders, and manage tasks.

Required `.env` values:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-5.2`)

Optional:
- `AGENT_LOG_PATH="data/agent.log"` to write message logs to a file.
- `AGENT_DB_PATH="data/agent.db"` to override where agent data is stored.
- `GITHUB_REPO="yourname/schoology-bot"` and `GITHUB_TOKEN="..."` to allow the agent to open GitHub issues.
- `GITHUB_LABELS="bug,agent"` to apply default labels when opening issues.
- `DATA_DIR="data"` to override the base data folder (useful for beta).
- `OPENAI_MAX_OUTPUT_TOKENS` to increase response length if replies are getting cut off.
- `OPENAI_CAPABILITY_GUARD=true` to enable/disable the capability gate for unsupported requests.

Note: If you use a group chat, Telegram bot privacy must be disabled (BotFather -> /setprivacy) or you must mention the bot for it to receive messages.

Tips:
- Say "file a bug" to log an error.
- Say "log a feature request" to capture improvements or ideas.

## Telegram Agent Notes
- The agent runs as a single instance; a lock file prevents duplicate responses.
- Incoming messages are batched briefly (about 1 second) so fast sequences become one request.
- If a batch exceeds the limit, the oldest messages are dropped to keep the newest context.
- The agent shows a typing indicator and sends a "Working on it..." message after 10 seconds if needed.
- Bootstrap context files are loaded if present: `AGENTS.md`, `TOOLS.md`, `SOUL.md`, and any markdown files in `skills/`.

## Secrets
Live production secrets should live in Windows Credential Manager, not inline in
`.env*` files. See `docs/SECRETS.md` for rotation, vault import/export, and
managed-prod cutover commands.

Quick checks:
- `powershell -ExecutionPolicy Bypass -File scripts/manage_schoology_secrets.ps1 -Action verify -Environment prod`
- `powershell -ExecutionPolicy Bypass -File scripts/manage_schoology_secrets.ps1 -Action export -Environment prod`
- `npm run secrets:scan`

## Skills (Local)
Place short, ASCII-only markdown files in `skills/` to extend the agent with local skills.
These are loaded into the agent context on each run.

## Managed Agents Dev Runtime
Claude Managed Agents is the active dev-to-prod replacement path for agent chat.
Use the managed-dev bot/thread for beta UAT and the current committed prod Docker
runtime for rollback planning until the managed path passes canary.

Managed prod uses:
`docker compose -f docker-compose.yml -f docker-compose.managed-prod.yml -p schoology-prod up -d --build`

## Tasks and Reminders
You can create personal tasks (not tied to Schoology) and get Telegram reminders.

Examples:
- "Remind me to ask a friend tonight at 9pm."
- "List my tasks for today."
- "Mark task 3 done."

Tasks roll over by 24 hours if they are not marked done.

Reminder delivery:
- The scheduler checks tasks every minute by default (`REMINDER_CRON`).
- The daily summary includes all tasks scheduled for today.
- If you change a reminder time, the agent will replace the existing pending reminder.
- To remove any legacy duplicates, run `npm run reminders:cleanup`.

## Auto-upcoming Reminders
The scheduler can auto-plan reminders for upcoming assignments.

Defaults (override via `.env`):
- `AUTO_UPCOMING_ENABLED=true`
- `AUTO_UPCOMING_DAYS=7`
- `AUTO_UPCOMING_REMIND_HOUR=16` (4pm local)
- `AUTO_UPCOMING_REMIND_MINUTE=0`

The auto-planner only creates a reminder when:
- The assignment is not missing.
- It has a due date within the next N days.
- It is not manually ignored.

## Auto-ignore Old or Non-graded Items
To reduce noise, missing items can be auto-ignored when they are clearly not actionable.

Defaults (override via `.env`):
- `AUTO_IGNORE_ENABLED=true`
- `AUTO_IGNORE_OLD_DAYS=120`
- `AUTO_IGNORE_KEYWORDS=practice,not for grade,non-graded,participation,optional`

## Manual Statuses (Explicit Set)
These are the default manual status codes the agent understands:
- `A` = `Excused (doesn't count)`
- `B` = `Practice / not for grade`
- `C` = `No way to fix it`
- `D` = `No grade put in yet`
- `E` = `Waiting on teacher`

The agent also accepts custom status text when you specify it explicitly.

By default, **Ignored** statuses (A/B/C) are hidden from the missing list unless you ask to show them.
Schoology items that are submitted but still ungraded are also archived/ignored by default.

## Tests (Offline)
Run unit and offline E2E tests without hitting Schoology:

```
npm test
```

What is covered:
- Offline grade parsing via HTML fixture.
- Manual status code mapping.
- Bulk and numbered status updates.
- Task reminder scheduling and rollover.
- Telegram formatting and batching.

## Twilio SMS (Experimental)
Twilio delivery is not fully implemented or tested. Prefer Telegram for now.
If you still want to try SMS, set `DELIVERY_CHANNEL="twilio"` and the Twilio env vars,
but expect rough edges until this path is fully validated.

For email delivery, set `DELIVERY_CHANNEL="email"` and the SMTP values.

## Roadmap
See `docs/ROADMAP.md`.

## Backlog
See `docs/BACKLOG.md`.

## Completed Work
See `docs/COMPLETED.md`.

## Architecture
See `docs/ARCHITECTURE.md`.

## Refreshing Schoology
If someone says "check again" or "I turned that in", the agent can run a fresh scrape and reconcile manual statuses.

Policy for manual statuses on resolved items:
- Auto-clear only A/B/C (ignored statuses) when the assignment is resolved and has no notes.
- Keep D/E (pending), any custom statuses, and anything with notes.
- The agent will summarize what it cleared and what it kept.

Refresh response behavior:
- The agent reports Actionable / Pending / Archived counts (not raw missing).
- Submitted-but-ungraded Schoology items are included in Archived by default.
- Archived items are still stored and can be shown on request (ex: "show ignored").
