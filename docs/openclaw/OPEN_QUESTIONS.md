# Open Questions

## Resolved (2026-02-16)
- Telegram IO for beta is gateway-native (no legacy Telegram adapter in the OpenClaw beta stack).
- Scheduling for beta is gateway cron, with managed jobs synced at startup.

## Remaining
1. Can OpenClaw handle our current tool set end-to-end (refresh, list missing, update status, reminders, daily summary)?
2. How does it handle clarifications for partial inputs (ex: "4pl")?
3. Can it avoid tool-call loops without extra heuristics?
4. What is the best way to run offline tests and a low-cost live dummy simulation?
5. How should we handle Schoology login state (Playwright) in an OpenClaw runtime?
