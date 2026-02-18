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
- Tail dashboard logs:
  `docker compose logs --tail 200 dashboard`
- Stop services:
  `docker compose down`

## Agent usage
- Prefer running the app via Docker Compose services (`schoology`, `telegram-agent`, `dashboard`).
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

## Planning Doc Drift Guardrails
- Canonical planning docs live on `main`:
  - `docs/ROADMAP.md`
  - `docs/BACKLOG.md`
  - `docs/SYSTEM.md`
  - `docs/TEST_COVERAGE.md`
- Branch-specific experiment notes must live under `docs/openclaw/` (or other branch-scoped docs), not by rewriting canonical planning docs.
- Before opening PRs or promoting beta/prod, reconcile planning docs against `main`:
  - `git diff --name-status main..HEAD -- docs/ROADMAP.md docs/BACKLOG.md docs/SYSTEM.md docs/TEST_COVERAGE.md`
- If branch edits are temporary, discard them before merge.
- If branch edits are improvements, port them intentionally to `main` first, then re-sync the branch.

## ExecPlans
- For complex features or significant refactors, use an ExecPlan as defined in `PLANS.md` (repo root).
- If an ExecPlan is required, keep it updated as a living document while you work.

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
