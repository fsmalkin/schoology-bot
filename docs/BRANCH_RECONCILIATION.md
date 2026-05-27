# Branch Planning Reconciliation

Date: 2026-02-14
Updated: 2026-05-25

## Scope
Compared planning/system documentation on:
- `main`
- `beta-telegram`
- `origin/beta-telegram`

Files checked:
- `docs/ROADMAP.md`
- `docs/BACKLOG.md`
- `docs/COMPLETED.md`
- `docs/SYSTEM.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST_COVERAGE.md`
- `README.md`

## Findings
- `beta-telegram` contains branch-specific OpenClaw UAT planning and some compacted system docs.
- OpenClaw is now archived as rollback/reference only; Claude Managed Agents is the active replacement path.
- `origin/beta-telegram` is further behind and deletes/omits some planning docs present on `main`.
- Planning drift exists primarily because beta branch docs were used for temporary execution notes.

## Reconciliation Decision
- Keep `main` as canonical source for roadmap/backlog/system planning.
- Keep current Managed Agents migration notes under `docs/managed-agents/`.
- Keep OpenClaw beta-specific details under `docs/openclaw/` only as archive/rollback context.
- Add explicit governance notes in `docs/ROADMAP.md` and `docs/BACKLOG.md`.

## Next Cleanup Step
- On next beta sync/rebase, update beta planning docs from `main`, retain OpenClaw notes only as archive context, and keep active migration work in `docs/managed-agents/`.
