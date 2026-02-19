# OpenClaw UAT Promotion Checklist

Purpose: decision-ready UAT checklist for promoting OpenClaw beta runtime to production.

## Scope (Wave 1)
- #10 Auto-cancel assignment reminders for inactive/resolved assignments.
- #14 DB-backed compaction memory for long threads.
- #15 Detail-page fallback for ambiguous submission status.
- #18 Secret/session-based unattended login bootstrap.

Deferred to post-UAT:
- #16 Plain-language recap/reminder mode.
- #17 "Will complete in class" manual status.

## Preconditions
1. Branch contains Wave 1 code + tests.
2. `.env.beta` is populated (Telegram/OpenAI/Schoology/OpenClaw values).
3. `OPENCLAW_GATEWAY_TOKEN` is set for beta stack.

## Automated Verification
Run from repo root:

```powershell
npm test
```

Must pass:
- Reminder auto-cancel coverage.
- Detail fallback ambiguity/cap coverage.
- Storage-state secrets/encryption coverage.
- Chat memory persistence/replay coverage.
- Existing regression suite.

## OpenClaw Runtime Verification
1. Start stack:

```powershell
docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta up -d --build
```

2. Verify core logs:

```powershell
docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-cron-sync
docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-gateway
docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 schoology-tool-api
```

3. Optional dashboard:

```powershell
docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta --profile dashboard up -d dashboard
docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 dashboard
```

## UAT Test Matrix
1. Login refresh and unattended auth:
   - Start with valid `STORAGE_STATE_B64` or encrypted storage-state input.
   - Confirm scrape runs without interactive browser.
   - Validate clear error text when session expires and credentials are absent.
2. Ambiguous assignment classification:
   - Trigger ambiguous list-state rows.
   - Confirm detail fallback resolves status.
   - Confirm submitted/ungraded rows land in archived/non-actionable behavior.
3. Reminder auto-cancel:
   - Create assignment-linked reminder.
   - Resolve/archive assignment via refresh.
   - Confirm reminder is auto-canceled and not delivered.
4. Long-thread continuity:
   - Drive thread past compaction threshold.
   - Confirm memory survives compaction and follow-up references still resolve.
5. Telegram behavior:
   - No duplicate sends.
   - No tool-call loops.
   - Expected reminder and summary formatting.

## Pass / Fail Checklist
- [ ] `npm test` passes.
- [ ] OpenClaw stack boots healthy.
- [ ] All UAT matrix items pass.
- [ ] No P1 regressions opened during UAT.
- [ ] Cutover + rollback notes reviewed.

## Promotion Signoff
- UAT owner:
- Date:
- Build/commit:
- Result: Pass / Fail
- Notes:

## Rollback Notes
If promotion fails or regressions appear:
1. Keep production on legacy stack (`schoology` + `telegram-agent`).
2. Rebuild last known-good production image from committed state.
3. Capture failing logs and link to GitHub issue(s) before re-attempting cutover.
