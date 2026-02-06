# OpenClaw Evaluation (beta branch)

This branch is repurposed for evaluating OpenClaw (clawdbot) as a potential new agent runtime.
We vendor the upstream repo as a git submodule at `vendor/openclaw` and keep our current
Schoology bot code in the repo root for comparison and migration planning.

## Why this branch exists
- Keep production stable on `main`.
- Test OpenClaw features and conventions without disturbing the current app.
- Build a clear migration plan and decide whether to adopt or stay with the current stack.

## How to pull the OpenClaw code
- Initialize submodules after clone:
  `git submodule update --init --recursive`
- Update to latest upstream:
  `git submodule update --remote --merge vendor/openclaw`

## Evaluation checklist (current use-cases only)
1. Refresh Schoology and list missing assignments (actionable vs pending vs archived).
2. Update manual status for a missing item (A/B/C/D/E style).
3. Add notes to assignments and see them in the daily summary.
4. Create reminders (standalone and assignment-linked), and deliver them on time.
5. Daily summary (morning): concise, respects manual status, includes tasks/reminders.
6. Telegram UX: formatting, no duplicate responses, no tool-call loops.
7. Error handling: retries, backoff, and friendly failure text without spam.

## Migration approach (draft)
1. Run OpenClaw locally using its default stack.
2. Map only the current tool set (refresh, list missing, update status, reminders, daily summary).
3. Use our existing Telegram IO (or an OpenClaw adapter if available).
4. Verify parity with the current bot behavior using fixtures + a live dummy simulation.
5. Decide: fully migrate, partially adopt, or stay as-is.

## Notes
- This is additive: no production files are replaced here.
- We will track open questions in `docs/openclaw/OPEN_QUESTIONS.md`.
