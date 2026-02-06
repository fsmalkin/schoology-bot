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

## Evaluation checklist (initial)
1. Tool calling model: how OpenClaw routes tools vs. our structured planner.
2. Memory + compaction: built-in memory options, storage model, and retrieval.
3. Conversation UX: clarifications, disambiguation, and partial intent handling.
4. Error handling: how it avoids tool-call loops and response spam.
5. Test strategy: how to run offline + live tests with minimal cost.

## Migration approach (draft)
1. Run OpenClaw locally using its default stack.
2. Map our tools: Schoology refresh, list missing, update manual status, reminders.
3. Implement a minimal adapter for Telegram IO (or use an OpenClaw adapter if available).
4. Verify parity with our current bot behavior using fixtures.
5. Decide: fully migrate, partially adopt (e.g., memory layer), or stay as-is.

## Notes
- This is additive: no production files are replaced here.
- We will track open questions in `docs/openclaw/OPEN_QUESTIONS.md`.
