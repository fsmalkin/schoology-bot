# AGENTS (repo-specific)

## Global Agent Policy

Global policy: `D:/dev/canon/docs/ops/agent-guidance/global-working-agreement.md @ 2026-05-04-act-or-wait`.

Runtime mirror: `C:/Users/afutu/.codex/GLOBAL_WORKING_AGREEMENT.md`.

This file is the Schoology Bot repo overlay. Keep universal agent behavior in
the global policy; keep Docker ops, Managed Agents migration, rollback, test,
and tracking rules here.

## Owner of Docker Ops
Codex owns Docker operations for this repo. Do not ask the user to restart services or run docker commands unless absolutely required.

## Default service management
- Build + restart after code changes:
  `docker compose -p schoology-prod up -d --build`
- Tail Telegram agent logs:
  `docker compose -p schoology-prod logs --tail 200 telegram-agent`
- Tail scheduler logs:
  `docker compose -p schoology-prod logs --tail 200 schoology`
- Tail dashboard logs:
  `docker compose -p schoology-prod logs --tail 200 dashboard`
- Stop services:
  `docker compose -p schoology-prod down`

## Managed-dev beta operations
- Beta UAT runs through the Managed Agents dev bot/thread, not a legacy compose stack.
- Beta runtime DB lives at `data/beta/agent.runtime.db`; any restore work must install it via container-side copy, not host-side `Copy-Item`, or SQLite can fail to open the bind-mounted file.

## Managed Agents migration
- Claude Managed Agents is the active dev-to-prod replacement path for the agent runtime.
- Do not add new legacy runtime UAT, cron hardening, upstream sync, or rollback work.
- Preserve the current committed Docker prod runtime as rollback target while implementing Managed Agents in dev.
- Route Claude custom tool requests through existing deterministic Schoology tool execution; do not bypass current DB/status/reminder rules.

## Agent usage
- Prefer running the app via Docker Compose services (`schoology`, `telegram-agent`, `dashboard`).
- When investigating issues, check Docker logs first, then `data/agent.log` if needed.
- If chat state/tool-call errors occur, restart services in Docker and re-test.

## Repo Automation Notes

- SOP: auto-update is manual unless a scheduler is configured. Use `scripts/auto_update.ps1 -Branch main` to pull and rebuild, and consider adding a scheduled task later.

## Planning Doc Drift Guardrails
- Canonical planning docs live on `main`:
  - `docs/ROADMAP.md`
  - `docs/BACKLOG.md`
  - `docs/SYSTEM.md`
  - `docs/TEST_COVERAGE.md`
- Managed Agents migration notes live under `docs/managed-agents/`; removed runtime experiments are not active planning.
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

## Repo Tracking Overlay

- Repo: `fsmalkin/schoology-bot`.
- Active execution source of truth: GitHub Project `FSM Engineering Board`.
- Track one issue per deliverable.
- Duplicate checks for this repo:
  - `gh issue list --repo fsmalkin/schoology-bot --state all --search "<terms> in:title,body sort:updated-desc" --limit 30`
  - `gh search issues "<terms> org:fsmalkin is:issue sort:updated-desc" --limit 30`
- At every pause/completion, update both:
  - issue comment handoff: Done, Next, Blockers
  - repo worklog entry: `Timestamp ET | Issue | Goal | Done | Next | Blockers | Validation run | Thread link`


## Owner-facing docs & dashboards: serve via the docs-hub (cross-project rule)
The owner reads on MOBILE over Tailscale. NEVER share a repo-relative `.md` path as the
only pointer — it doesn't render on a phone. Publish, then share the full URL.
- **The hub (always-on, independent of every dev server):** `node D:\services\docs-hub\hub-server.js`
  — port **8123**, binds 0.0.0.0, root-jailed static server over `D:\services\docs-hub\site\<project>\...`.
  If `http://127.0.0.1:8123/` is down (e.g. after reboot), restart it via a `run_in_background` shell call.
- **Publish a doc:** copy the `.md` into `D:\services\docs-hub\site\<project>\docs\` and add an entry to
  the `INDEX` array in `site\<project>\docs\index.html` (the mobile markdown renderer — copy
  `site\factr\docs\index.html` to bootstrap a new project). Share:
  `http://100.112.221.6:8123/<project>/docs/?doc=<file-stem>`
- **Dashboards:** publish to `site\<project>\` (e.g. `plan-progress.html`) → share
  `http://100.112.221.6:8123/<project>/<file>`.
- Lead with the Tailscale URL (`100.112.221.6` — stable); the repo path may follow in parentheses.
