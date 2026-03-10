# Dashboard

Purpose: local-first parent dashboard for managing one child's schoolwork after school, with assignment updates first and runtime health tucked behind `Admin`.

## URL
- Local bookmark: `http://127.0.0.1:8787`
- JSON health API: `http://127.0.0.1:8787/api/health`
- Optional Tailscale URL: `https://<TAILSCALE_DASHBOARD_HOSTNAME>.<tailnet>.ts.net`

## What it displays
- `Home`
  - One dominant `Needs Attention Tonight` section above the fold.
  - Quieter secondary sections for `Waiting on School` and `Coming Up`, plus a collapsed `Handled for Now`.
  - A compact summary ribbon with `Tonight`, `Waiting`, and `Next reminder`.
  - Mixed assignment and personal follow-up cards so the parent sees one plan.
- `All Schoolwork`
  - Search plus one scope filter, followed by a single grouped list for `Needs attention`, `Waiting on school`, and `Handled for now`.
  - `Handled for now` stays collapsed until expanded.
  - Bulk status updates are available only after turning on `Bulk select`.
  - Shared review drawer for status saves, note history, reminder edit/delete, and follow-up edits.
- `Admin`
  - Service health for legacy or OpenClaw runtime.
  - Last scrape and summary freshness.
  - Assignment/follow-up snapshot counts.
  - Common Docker commands, docs pointers, and runtime explanation.

## Interaction model
- Cards do not perform writes from the card face.
- Click any assignment or follow-up card to open the right-side review drawer.
- Assignment writes happen in the drawer with explicit save buttons:
  - `Save status`
  - `Save note`
  - `Save reminder`
- The drawer opens with `Update status` expanded and keeps `Reminder` and `Notes` collapsed until opened.
- The `Submitted` outcome is still a composite dashboard action, but it only runs when `Save status` is pressed.
- The drawer closes with the close button, backdrop click, or `Escape`.

## API surface
- `GET /api/health`
  - Existing operations snapshot endpoint.
- `GET /api/meta`
  - View metadata, parent-facing labels, manual status options, recurrence options, and allowed write tools.
- `GET /api/home`
  - Parent-home payload with summary counts and sectioned assignment/follow-up cards.
- `GET /api/assignments`
  - `All Schoolwork` assignment rows with summary counts, notes preview, reminder summary, and bucket labels for card grouping.
- `GET /api/assignments/:key/detail`
  - One assignment with full note history and reminder detail.
- `GET /api/tasks`
  - Standalone personal follow-up rows only.
- `POST /api/tools/run`
  - Dashboard-scoped write endpoint using deterministic tool execution for assignment/follow-up actions.

## Data sources
- `data/state.json` for last scrape and summary metadata.
- SQLite (`AGENT_DB_PATH`) for assignments, notes, reminders, and follow-ups.
- `data/health/*.heartbeat.json` files for process health.

Heartbeat writers:
- Scheduler writes `scheduler.heartbeat.json`.
- Telegram agent writes `telegram-agent.heartbeat.json`.
- Schoology Tool API writes `schoology-tool-api.heartbeat.json`.
- OpenClaw gateway monitor writes `openclaw-gateway.heartbeat.json`.
- Dashboard writes `dashboard.heartbeat.json`.

## Run
Docker Compose (default):
- `docker compose -f docker-compose.yml -p schoology-prod up -d --build`
- Open `http://127.0.0.1:8787`

Docker Compose + Tailscale (optional profile):
- Set `TAILSCALE_AUTH_KEY` in `.env`.
- Optional: set `TAILSCALE_DASHBOARD_HOSTNAME` (default `schoology-dashboard`).
- Run `docker compose --profile tailscale up -d --build`.
- Open `https://<TAILSCALE_DASHBOARD_HOSTNAME>.<tailnet>.ts.net` from any device on your tailnet.

Local Node process:
- `npm run dashboard`

## Config
- `DASHBOARD_PORT` (default `8787`).
- `TAILSCALE_AUTH_KEY` to enable dashboard Tailscale sidecar profile.
- `TAILSCALE_DASHBOARD_HOSTNAME` (default `schoology-dashboard`).
- Uses existing app config for timezone and DB/data paths.

## Troubleshooting
If `Home` or `All Schoolwork` looks stale or wrong:
1. Use the `Refresh Schoology` action in the header.
2. Check the scheduler and agent logs:
   - `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 schoology`
   - `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 telegram-agent`
3. Confirm `data/state.json` and `data/agent.db` are updating.

If `Admin` shows stale/down services:
1. Check service logs for your runtime mode:
   - Legacy: `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 schoology` and `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 telegram-agent`
   - OpenClaw beta: `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p schoology-openclaw-beta logs --tail 200 schoology-tool-api`
2. Confirm heartbeat files are updating:
   - Legacy: `data/health/scheduler.heartbeat.json` and `data/health/telegram-agent.heartbeat.json`
   - OpenClaw: `data/beta/health/schoology-tool-api.heartbeat.json` and `data/beta/health/openclaw-gateway.heartbeat.json`
3. Rebuild/restart services:
   - `docker compose -f docker-compose.yml -p schoology-prod up -d --build`

If the dashboard does not open:
1. Confirm port mapping in `docker-compose.yml` (`127.0.0.1:8787:8787`).
2. Check dashboard logs:
   - `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 dashboard`
3. Verify no local process conflict on port `8787`.

If the Tailscale URL does not open:
1. Check Tailscale sidecar logs:
   - `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 dashboard-tailscale`
2. Confirm profile was enabled:
   - `docker compose --profile tailscale ps`
3. Confirm `TAILSCALE_AUTH_KEY` is set and valid in `.env`.

## Security notes
- Dashboard is intentionally local-first with no auth layer.
- Compose maps only loopback by default (`127.0.0.1`), not all interfaces.
- Tailscale exposure is private to your tailnet and governed by your ACL policy.
- Dashboard write routes require JSON plus a same-origin custom header check; they are intended for the bundled dashboard UI, not generic cross-site POSTs.
- Do not expose dashboard port externally on public interfaces without adding authentication.
