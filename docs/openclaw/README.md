# OpenClaw Evaluation Archive

Status: rollback/reference only as of 2026-05-25.

OpenClaw was evaluated as a possible beta runtime for Schoology Bot. The prior
direction used OpenClaw gateway for Telegram and cron, with `schoology-tool-api`
as the deterministic Schoology/task sidecar.

## Final Decision
Do not continue OpenClaw as the migration path.

Reason:
- Runtime instability and operational shaping cost are too high for this repo.
- Claude Managed Agents is now the top-priority dev-to-prod replacement path.
- Production must remain on the current Docker runtime until Managed Agents
  passes parity and rollback gates.

## Historical Outcome
- OpenClaw beta reached a usable rollback/reference state.
- The one-gateway stack and project naming remain documented for recovery
  context.
- No further OpenClaw UAT, cron hardening, or upstream sync work should be added
  unless the user explicitly asks to revive it.

## Historical Files
- `docker-compose.beta-openclaw.yml`
- `scripts/openclaw_cron_sync.mjs`
- `src/openclaw_tool_api.js`
- `src/openclaw_gateway_monitor.js`
- `data/openclaw-beta/`
- `openclaw_workspace/`

## Replacement Path
See `docs/managed-agents/README.md`.
