# AGENTS (repo-specific)

## Owner of Docker Ops
Codex owns Docker operations for this repo. Do not ask the user to restart services or run docker commands unless absolutely required.

## Default service management
- Build + restart after code changes:
  `docker compose up -d --build`
- Tail Telegram agent logs:
  `docker compose logs --tail 200 telegram-agent`
- Tail scheduler logs:
  `docker compose logs --tail 200 schoology`
- Stop services:
  `docker compose down`

## Agent usage
- Prefer running the app via Docker Compose services (`schoology`, `telegram-agent`).
- When investigating issues, check Docker logs first, then `data/agent.log` if needed.
- If chat state/tool-call errors occur, restart services in Docker and re-test.

## Process (Library-First + Retros)
- Prefer existing libraries or standard approaches before implementing new logic.
- After incidents or learning points, run a short retro and update:
  - AGENTS.md (process rules)
  - TOOLS.md / SOUL.md (agent behavior and constraints)
  - docs/ROADMAP.md (future work or guardrails)
- For new agent behaviors, keep a brief "Decision + Outcome" note in docs (what was chosen, why, fallback).
- SOP: auto-update is manual unless a scheduler is configured. Use `scripts/auto_update.ps1 -Branch main` to pull and rebuild, and consider adding a scheduled task later.

## System documentation
- Primary reference: `docs/SYSTEM.md`
- Test coverage and gaps: `docs/TEST_COVERAGE.md`

## Test coverage SOP (required for new functionality)
- Add unit tests for core logic and edge cases.
- Add integration tests for tool flows and agent routing when applicable.
- Add or update smoke tests (Docker or CLI) when runtime behavior changes.
- Add CLI coverage when a user-facing command or script changes.
- Update `docs/TEST_COVERAGE.md` to record coverage and any remaining gaps.

## Rollback
- Revert to previous image by rebuilding from last committed state:
  `git checkout .` then `docker compose up -d --build`
