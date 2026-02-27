# Health Dashboard

Purpose: lightweight local page for operations health and quick system memory.

## URL
- Local bookmark: `http://127.0.0.1:8787`
- JSON API: `http://127.0.0.1:8787/api/health`
- Optional Tailscale URL: `https://<TAILSCALE_DASHBOARD_HOSTNAME>.<tailnet>.ts.net`

## What it displays
- Service health:
  - Legacy mode: Scheduler + Telegram agent heartbeat freshness.
  - OpenClaw mode: Schoology Tool API + OpenClaw gateway heartbeat freshness.
- Activity freshness:
  - Last scrape timestamp.
  - Last summary send timestamp.
- Workload snapshot:
  - Actionable / waiting / ignored assignment counts.
  - Pending / overdue / today / upcoming task counts.
- Operations helpers:
  - Common Docker commands.
  - Pointers to core docs.
  - Short "How it works" explanation.

## Data sources
- `data/state.json` for last scrape and summary metadata.
- SQLite (`AGENT_DB_PATH`) for assignments and task counts.
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
If the page loads but shows stale/down services:
1. Check service logs for your runtime mode:
   - Legacy: `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 schoology` and `docker compose -f docker-compose.yml -p schoology-prod logs --tail 200 telegram-agent`
   - OpenClaw beta: `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p schoology-openclaw-beta logs --tail 200 schoology-tool-api`
   - OpenClaw beta dashboard (optional profile): `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p schoology-openclaw-beta --profile dashboard up -d dashboard`
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
- Do not expose dashboard port externally on public interfaces without adding authentication.
