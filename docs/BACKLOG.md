# Backlog

This file tracks active and proposed work items with GitHub issue linkage.

## P1 (Current)
1. OpenClaw beta UAT and production promotion readiness
   - Status: In progress
   - Outcome target: Confirm parity for refresh/chat/reminders and complete a low-risk production cutover checklist.
2. #10 Auto-cancel reminders for inactive/resolved assignments
   - Status: Open (Wave 1 UAT blocker)
   - Outcome target: Assignment-linked reminders do not fire after item becomes inactive.
3. #14 DB-backed context compaction and long-thread memory
   - Status: Open (Wave 1 UAT blocker)
   - Outcome target: Long chats retain critical context with bounded token use.
4. #15 Detail-page fallback for ambiguous submission status
   - Status: Open (Wave 1 UAT blocker)
   - Outcome target: Submission state classification remains accurate when list view is ambiguous.
5. #18 Automate Schoology login via secrets for unattended runs
   - Status: Open (Wave 1 UAT blocker)
   - Outcome target: Headless unattended runs can bootstrap session state and recover with clear auth errors.

## P2 (Post-UAT)
1. #16 Plain-language mode for recaps/reminders (reduce shorthand)
   - Status: Open (post-UAT)
   - Outcome target: Recaps/reminders are easier to scan without internal abbreviations.
2. #17 Add assignment status: Will complete in class
   - Status: Open (post-UAT)
   - Outcome target: In-class completion intent is tracked as Pending/Waiting without noisy actionable reminders.
3. Recurring reminder support
   - Status: Not yet filed
   - Outcome target: User can create, edit, and delete recurring reminders safely.
4. OpenClaw upstream sync SOP
   - Status: Not yet filed
   - Outcome target: Repeatable update cadence with verification checklist.
5. Scheduled auto-update task decision
   - Status: Not yet filed
   - Outcome target: Decide manual-only vs scheduled update path.
6. Agents SDK evaluation
   - Status: Not yet filed
   - Outcome target: Decision memo on staying with current architecture vs adopting SDK.

## Recently Groomed Issues
1. #8 Renamed for clarity: reminder shorthand parsing/confirmation flow.
2. #9 Renamed for clarity: empty/low-context bug filing issue.
3. #11 Closed: beta skill smoke check for empty issue handling.
4. #12 Closed: weekend daily schedule update enhancement.
5. #13 Completed in code: capability registry + planner/agent guardrails.

## Planning Governance
- Canonical backlog lives on `main`.
- Branch-specific backlog items (e.g., OpenClaw beta experiments) should be kept in branch docs and merged only after validation.

## Recently Completed
1. Local server migration off laptop runtime
   - Status: Completed (2026-02-18)
   - Outcome: Production runtime now runs on local server Docker with persistent data and health checks.
