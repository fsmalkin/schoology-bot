# AGENTS (repo-specific)

## Global policy

Use the active global startup and the complete reviewed Global Agent Working
Agreement. Canon on this Windows workspace:
`D:/dev/canon/docs/ops/agent-guidance/global-working-agreement.md`
at version `2026-10-15-native-delivery-cuts`.

This overlay supplies Schoology-specific commands, test and tracking notes.
Current global authority and the canonical task checkpoint govern actual
effects; historical commands in this file do not grant access or restart work.

## Docker operations

Codex owns approved Docker operations for this repository. Do not ask Fred
to run routine commands that the owning task can execute.

The commands below are references for an authorized runtime action. Check
the existing checkpoint for the exact runtime, data, sending, credential and
legal boundaries. Source or documentation qualification does not automatically
require a rebuild, restart, scrape or send.

- Build/restart: `docker compose -p schoology-prod up -d --build`
- Telegram logs: `docker compose -p schoology-prod logs --tail 200 telegram-agent`
- Scheduler logs: `docker compose -p schoology-prod logs --tail 200 schoology`
- Dashboard logs: `docker compose -p schoology-prod logs --tail 200 dashboard`
- Stop: `docker compose -p schoology-prod down`

Read only logs and data already within the action's authorized scope.

## Runtime and tool continuity

The current issue controls the active consumer path, runtime and migration.
Preserve existing configured resources and deterministic assignment, status,
note, task and reminder semantics. This overlay does not select a new carrier,
revive retired control planes or clear an existing runtime hold.

For approved Managed Agents beta work, use its existing dev bot/thread.
For an authorized beta DB restore, the runtime DB is
`data/beta/agent.runtime.db`; install through container-side copy rather than
host-side Copy-Item so the SQLite bind mount remains usable. This is a
procedure reference, not permission to read or restore a held original store.

## Manual updates

Auto-update is manual unless an actual scheduler is configured. The existing
`scripts/auto_update.ps1 -Branch main` helper pulls and rebuilds; invoke it only
for an approved runtime update. Preserve actual schedule state and identity.

## Planning and documentation alignment

Canonical repository documents:

- `docs/ROADMAP.md`
- `docs/BACKLOG.md`
- `docs/SYSTEM.md`
- `docs/TEST_COVERAGE.md`

Reconcile intentional planning changes against the current target branch in
the normal coherent source/documentation review. Carry useful improvements
with the implementation and discard only task-owned temporary edits.
A preliminary planning-only merge is not a universal prerequisite; use one
only when a concrete product or release requirement calls for it.

Use an ExecPlan in `PLANS.md` when it helps complex work, and keep an existing
plan current. Planning artifacts do not replace the approved outcome or create
a fresh admission or ACK gate for ordinary continuation.

## Test coverage

- Add unit coverage for new core logic and meaningful edge cases.
- Add integration coverage for changed tool flows and agent routing.
- Update an applicable Docker or CLI smoke check when runtime behavior changes.
- Cover changed user-facing CLI commands.
- Update `docs/TEST_COVERAGE.md` with bounded results and remaining gaps.

Use the normal repository CI and affected checks. Preserve required consumer
UAT and actual provider/privacy limits; fixture results do not prove live access.

## Rollback

Prefer a scoped commit revert or the known prior artifact for an authorized
rollback. Preserve unrelated dirty work. Do not use an unscoped checkout/reset
to discard other changes, and do not infer data-restore or runtime permission
from a source rollback.

## Tracking and owner-facing records

Repository: `fsmalkin/schoology-bot`. Reuse the current canonical delivery issue
and checkpoint; do not create a new issue for every helper result.
GitHub carries executable engineering evidence and Linear carries owner-facing
planning, status and actions. Record material changes in the existing issue
and `docs/WORKLOG.md`; routine unchanged receipts stay in the task transcript.

Worklog format:
`Timestamp ET | Issue | Goal | Done | Next | Blockers | Validation run | Thread link`

When a genuinely new issue is needed, check repository and owner duplicates:

- `gh issue list --repo fsmalkin/schoology-bot --state all --search "<terms> in:title,body sort:updated-desc" --limit 30`
- `gh search issues "<terms> org:fsmalkin is:issue sort:updated-desc" --limit 30`

Use tappable Linear/GitHub links for owner-facing records. Docs-hub is retired;
do not start it or publish through its historical commands.
