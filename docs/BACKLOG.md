# Backlog

This file tracks active and proposed work items with GitHub issue linkage.

## P1 (Current)
1. Recurring reminders release gate and rollout
   - Status: In progress
   - Outcome target: Complete beta reset, story suite, one-pass GPT-5.2 judge evidence, user UAT, and production rollout.
   - Acceptance gate:
     - `scripts/reset_beta_from_prod_memory.ps1` report artifact produced.
     - Agentic story suite artifacts produced.
     - One GPT-5.2 judge JSON artifact produced with required stories passing.
2. OpenClaw beta UAT and production promotion readiness
   - Status: In progress
   - Outcome target: Confirm parity for refresh/chat/reminders and complete a low-risk production cutover checklist.
3. #14 DB-backed context compaction and long-thread memory
   - Status: Open
   - Outcome target: Long chats retain critical context with bounded token use.
4. #15 Detail-page fallback for ambiguous submission status
   - Status: Open
   - Outcome target: Submission state classification remains accurate when list view is ambiguous.
5. #10 Auto-cancel reminders for inactive/resolved assignments
   - Status: Open
   - Outcome target: Assignment-linked reminders do not fire after item becomes inactive.

## P2 (Planned)
1. OpenClaw upstream sync SOP
   - Status: Not yet filed
   - Outcome target: Repeatable update cadence with verification checklist.
2. Scheduled auto-update task decision
   - Status: Not yet filed
   - Outcome target: Decide manual-only vs scheduled update path.
3. Agents SDK evaluation
   - Status: Not yet filed
   - Outcome target: Decision memo on staying with current architecture vs adopting SDK.
4. Cross-project rollout of the agentic release pattern
   - Status: Not yet filed
   - Outcome target: Reuse beta reset + story gate + judge evidence flow in other repos as a standard release template.

## Recently Groomed Issues
1. Recurring reminder support: moved from groomed scope to active release execution (2026-02-22).
2. #8 Renamed for clarity: reminder shorthand parsing/confirmation flow.
3. #9 Renamed for clarity: empty/low-context bug filing issue.
4. #11 Closed: beta skill smoke check for empty issue handling.
5. #12 Closed: weekend daily schedule update enhancement.
6. #13 Completed in code: capability registry + planner/agent guardrails.

## Planning Governance
- Canonical backlog lives on `main`.
- Branch-specific backlog items (e.g., OpenClaw beta experiments) should be kept in branch docs and merged only after validation.
- Intake first: duplicate-check evidence is required before creating/adding work items.
- Active execution state lives on the GitHub Project `FSM Engineering Board`; this backlog stays strategic.
- Cross-thread handoff also updates `docs/WORKLOG.md`.

## Recently Completed
1. Local server migration off laptop runtime
   - Status: Completed (2026-02-18)
   - Outcome: Production runtime now runs on local server Docker with persistent data and health checks.

