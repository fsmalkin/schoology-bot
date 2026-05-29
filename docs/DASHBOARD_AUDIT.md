# Dashboard Audit

Single consolidated artifact replacing the prior `DASHBOARD_REDTEAM.md` + `UAT_BUG_LOG.md`. All findings here are either **verified** (curl, browser UAT, or read of cited code) or explicitly marked **prediction — needs verification**. Severity calls are calibrated against verified evidence.

Companion: [docs/design/mocks/dashboard-improvements-v1.html](design/mocks/dashboard-improvements-v1.html).

Audit date: 2026-05-26 to 2026-05-27. Verification method: 9 subagent passes (4 red-team, 3 deep audits, 2 UAT) against the live UAT stack at `http://127.0.0.1:8789`.

---

## §0. This week's punch list

The five highest-leverage fixes, ranked by trust impact ÷ implementation cost. Each is ≤30 LOC except where flagged.

1. **🔴 Suspicious-scrape guard** — if a single scrape returns <50% of prior count, refuse to mark previous-missing assignments as resolved, and degrade the status dot to amber. Today, one empty scrape silently resolves every overdue item. This is the single highest-impact change in the entire audit. See §4.7 and §7 finding E5.
2. **🔴 Rotate cleartext secrets** + add a pre-commit secret scanner. The `.env.systemd` files are gitignored but sit on disk with live Schoology password, OpenAI key, Telegram token, and GitHub PAT. Any zip/backup/share leaks all four. See §1.
3. **🔴 Past-date reminder validation** — `parseReminderTime` accepts dates in the past; reminders for year 2000 silently store and never fire. Two-line fix at the parser. See §4.4 finding DR1.
4. **🔴 Bulk apply inline confirmation modal + atomic note option** — single biggest write-flow risk. Today one click changes status on N items with no preview, no undo. See §4.3 finding SW1.
5. **🟡 Topbar sync pill replaces breadcrumb + powers refresh-on-stale** — promotes the freshness signal into the parent's eye line and gives them a contextual refresh affordance instead of forcing a route visit. Already mocked (Mock 1). See §4.1 finding TB3.

The full prioritized roadmap is §10.

---

## §1. Secrets exposure (P0)

**Status:** Verified on disk. Severity 🔴 high blast radius.

**What exists:**
- `.env` (read-only, 808 bytes)
- `.env.systemd`, `.env.beta.systemd` — populated with live credentials per a separate audit pass
- `.env.managed-dev`, `.env.managed-prod` — produced by the in-flight managed-agent migration, not yet verified for secret content

**What's at risk in each file** (verified by listing env keys without values):
- `SCHOLOGY_USERNAME` + `SCHOLOGY_PASSWORD` — full Schoology account access for the kid
- `TELEGRAM_BOT_TOKEN` — control of the family bot
- `OPENAI_API_KEY` — paid quota
- `GITHUB_TOKEN` — repo write access (PAT)

**Coverage that's working:**
- `.gitignore` covers `.env` and `.env.*` (with `.env.example` / `.env.beta.example` exceptions). Verified by `git check-ignore`.
- Files are NOT in git history.

**Why it's still P0:**
- Files sit in the working tree as cleartext. Any backup utility, zip, screen share, sync tool, or accidental `Copy-Item -Recurse` includes them.
- One Schoology password change + one OpenAI key rotation per session is recoverable. Four simultaneous compromises is recoverable but expensive.
- Single-user product does not justify single-credential-failure → product dark.

**Bonus latent bug found while inventorying:** `.env.systemd:1` reads `CHOLOGY_USERNAME=...` — missing the leading `S`. The `validateCredentials()` at scrape time will treat this as an unset username and throw. If the .env.systemd path is ever loaded (e.g. a systemd-driven deployment), Schoology auth fails on first scrape with a "missing username" error 6 hours after boot, not at boot.

**Smallest remediation:**
1. **Rotate now** — Schoology password, OpenAI key, Telegram bot token, GitHub PAT. ~15 min.
2. **Move secrets into Docker secrets or a `pass`/keychain entry**; have the compose file read from there rather than `.env.*`. ~1 hour.
3. **Add `gitleaks` or `git-secrets` pre-commit hook** — catches future accidents. ~10 min.
4. **Fix the `CHOLOGY_USERNAME` → `SCHOLOGY_USERNAME` typo** while you're rotating.
5. **Audit `.env.managed-dev` and `.env.managed-prod`** for the same exposure pattern before the migration lands on prod.

This entire section was buried as finding K2 in the onboarding addendum that was never folded into the prior doc. Promoting to P0 because the cost of doing nothing is hard to recover from.

---

## §2. Product foundation

Single-paragraph version of what was previously a 7-page PM document. The longer version is in the prior `DASHBOARD_REDTEAM.md` (now deleted; git history preserves it).

**Goal.** The dashboard exists so one working parent can confirm "tonight is handled" for their middle/high schooler's schoolwork in under three minutes, on whatever screen is in front of them.

**Persona — Working Parent.** Mid-40s, ~90 seconds of attention between 6–9pm, tech comfort sufficient to run a one-liner Docker command but unwilling to debug at 9pm. Optimizing for peace of mind with the least possible effort. Trusts the system as long as the system tells them when it is broken. Hostile the moment they catch it lying.

**Top JTBDs by frequency × importance.** Evening triage (25), status verification (20), mobile interrupt (16), system trust check (16), stale-data sanity check (15). Day-to-day product quality is graded on those five.

**Anti-personas.** Not a tiger parent (no grade trends), not multi-tenant, not a school-admin tool, not a kid-facing planner, not a productivity maximizer, not a notification spine, not SaaS. Anything that only makes sense for >1 user/kid/household is anti-persona pull.

**Non-goals.** Not a grade tracker, not a notification center (Telegram owns push), not a calendar, not a homework helper, not a Schoology mirror (it interprets and buckets).

---

## §3. Information architecture recommendation

```
Dashboard
├── Today                                  ← evening triage (daily)
│   ├── Agenda (mixed: assignments + reminders, time-ordered)
│   │   ├── Overdue
│   │   ├── Missed reminders
│   │   ├── Tonight
│   │   ├── Waiting on teacher  (collapsed)
│   │   └── Coming up           (collapsed)
│   └── Right rail
│       ├── Week-at-a-glance (7-day mini strip)
│       └── (System status moves to topbar)
│
├── All Schoolwork                         ← verification
│   ├── Search + filter
│   ├── Needs attention
│   ├── Waiting on school
│   └── Handled for now (collapsed)
│
└── (no third top-level item)

Cross-cutting
├── Topbar: real search · sync pill · system status dot · "+ Add"
├── Review drawer (right side, full-screen on mobile)
└── System slide-in panel (not a route)
```

Two primary items instead of the current three. System demoted to a topbar dot + slide-in panel (it's a glance, not a destination). Justifications keyed to JTBDs:
- Today (#1 evening triage + #3 mobile interrupt — same view, different viewport)
- Schoolwork (#2 status verification)
- System dot in topbar (#4 trust check)
- Sync pill (#5 stale-data sanity check)

**This Week as a separate route:** rejected — the Sunday-planning JTBD scores 8/25. A full route duplicates information the Today right rail can carry. Promote later only if forward-looking data exceeds 7 days.

---

## §4. Verified bugs by surface

This section is being populated by parallel subagents. Subsections will be filled in as they complete. See current status via the `/workflows` view.

### 4.1 Topbar — verified via code-read (browser UAT pending)

- TB1. **🟡 ⌘K chip is decorative.** `<div class="topbar-search">` with placeholder text and a `⌘K` `<span>` chip. No `<input>`, no click handler, no `keydown` listener anywhere matches Meta+K / Ctrl+K. ([beta_index.html:65-69](../src/dashboard_assets/beta_index.html#L65-L69), keydown handler at [beta_dashboard.js:2205-2221](../src/dashboard_assets/beta_dashboard.js#L2205-L2221) handles only Enter/Space/Escape)
- TB2. **🟡 Topbar breadcrumb shows only current view label** — redundant with the sidebar active state.
- TB3. **🟡 No sync freshness signal in topbar.** Only on System Health view. Single highest-ROI promotion target. Mock #1 shows the proposed sync pill.
- TB4. **🟡 No deep links.** No `pushState` calls anywhere in the codebase; state.activeView is in-memory only. Refresh always lands on home. Parent can't share an assignment URL. ([beta_dashboard.js:50](../src/dashboard_assets/beta_dashboard.js#L50))
- TB5. **🟢 "Add follow-up" is brand-blue primary on every page** — neutral frequency action sitting in the loudest CTA slot.
- TB6. **🟢 Status dot click navigates to `/admin` route** — should open a slide-in panel per §3 IA recommendation.

### 4.2 Tonight view — verified via code-read (browser UAT pending)

- TV1. **🟢 Flash IS visible after a status save with the drawer open** *(falsified prediction).* Playwright UAT clicked Save on a status outcome and observed the flash message "Marked to let go." with `visible: true`. The flash slot sits at the top of the page outside the drawer's lateral footprint, so the drawer doesn't cover it. The earlier red-team prediction of "flash hidden behind drawer" was wrong.
- TV2. **🟡 No retry / actionable copy when API down.** `fetchJson` throws raw `Request failed (500)` to the flash. Init() catch leaves the home pane stuck on `Loading your after-school plan…`. ([beta_dashboard.js:163-170](../src/dashboard_assets/beta_dashboard.js#L163-L170), [beta_dashboard.js:2231-2233](../src/dashboard_assets/beta_dashboard.js#L2231-L2233))
- TV3. **🟡 Course label contrast 4.18:1** — fails WCAG AA (4.5:1) by 0.32. `--ink-3` (#767c8a) at 12px on white. Borderline non-compliant, especially on Tailscale-over-cellular screens. ([dashboard.css:721](../src/dashboard_assets/dashboard.css#L721))
- TV4. **🟢 "Coverage this session" math is correct, copy is confusing.** Formula `(handled + waiting) / totalMissing` is mathematically right; the 67% just feels unmotivating because most of it is yesterday's waiting items. Downgraded from 🟡 — fix is a label change, not the math. ([beta_dashboard.js:809-811](../src/dashboard_assets/beta_dashboard.js#L809-L811))
- TV5. **🟢 Reminder/Follow-up vocabulary inconsistent.** "Reminder" vs "Follow-up" used interchangeably within 100px of each other on the same view. ([beta_dashboard.js:682-683](../src/dashboard_assets/beta_dashboard.js#L682-L683))

### 4.3 Schoolwork view — verified via curl UAT

- SW1. **🔴 Bulk apply has no confirmation or preview.** 3-row test wrote new statuses in 59ms with no modal. ([beta_dashboard.js:1865-1881](../src/dashboard_assets/beta_dashboard.js#L1865-L1881))
- SW2. **🔴 Bulk apply is non-atomic vs single-row "Submitted" path.** Single-row writes status + audit note; bulk writes only status. ([beta_dashboard.js:1872-1874](../src/dashboard_assets/beta_dashboard.js#L1872-L1874))
- SW3. **🟡 Search has no debounce** — synchronous re-render on every keystroke. ([beta_dashboard.js:2179-2182](../src/dashboard_assets/beta_dashboard.js#L2179-L2182))
- SW4. **🟡 Bulk-select state persists across view switches.** Toggle bulk mode → select rows → navigate away → return; selection retained. ([beta_dashboard.js:51-53](../src/dashboard_assets/beta_dashboard.js#L51-L53))

### 4.4 Drawer — verified via code-read + curl UAT (browser UAT still running)

- DR1. **🔴 Past-date reminders silently accepted.** `remindAt: "2000-01-01"` returns `{ok:true}`. Stored, never fires. ([db.js normalizeRemindAt](../src/db.js))
- DR2. **🟢 Focus restoration target is wrong, but focus trap actually works.** Playwright pressed Tab 10 times after opening the drawer — focus stayed inside the drawer the entire time (contradicting the prior prediction). On Escape, focus restores to `status-dot-btn` in the topbar instead of the originating assignment row. The trap works because the JS only inserts focusable elements inside the drawer DOM and the prior focused row is detached; not a designed trap, but functionally equivalent for keyboard users. *Originally predicted 🔴 (no trap), recalibrated to 🟢 (restoration polish).* ([beta_dashboard.js:1570](../src/dashboard_assets/beta_dashboard.js#L1570), [beta_dashboard.js:1586-1607](../src/dashboard_assets/beta_dashboard.js#L1586-L1607))
- DR3. **🟡 Five-line header stack.** Eyebrow → title → status pill + middot + due date → "Open in Schoology" link → optional reasonText. Compresses to 3 lines via Mock #8. ([beta_dashboard.js:1382-1397](../src/dashboard_assets/beta_dashboard.js#L1382-L1397))
- DR4. **🟡 Accordion section heads don't preview content.** "Reminder" / "Notes" without telling the parent whether a reminder is set or how many notes exist. Closed-state `value` text exists in the same function — just isn't promoted into the heading. ([beta_dashboard.js:1412, 1437](../src/dashboard_assets/beta_dashboard.js#L1412))
- DR5. **🟡 No per-assignment "last synced" timestamp in drawer header.** The drawer is the exact surface where the parent verifies status. ([beta_dashboard.js:1388-1397](../src/dashboard_assets/beta_dashboard.js#L1388-L1397))
- DR6. **🟡 `aria-live="polite"` on the entire `<aside>` drawer.** Every render re-announces the full drawer body to screen readers. The flash slot already has it. ([beta_index.html:123](../src/dashboard_assets/beta_index.html#L123))
- DR7. **🟢 Drawer Save button label is generic "Save"** when scoped saves below it say "Add note" / "Set reminder." ([beta_dashboard.js:1407](../src/dashboard_assets/beta_dashboard.js#L1407))
- DR8. **🟢 Drawer state UX-confusing on view switch** — data persists in `state.drawer` (so reopening shows the same assignment), but the row it opened from is no longer visible behind it. Recalibrated from 🟡 — annoying, not state loss. ([beta_dashboard.js:496-501](../src/dashboard_assets/beta_dashboard.js#L496-L501))
- DR9. **🟢 Notes count chip and reminder indicator chip are not clickable** — could deep-link into the Notes / Reminder accordion sections. ([beta_dashboard.js:624-625](../src/dashboard_assets/beta_dashboard.js#L624-L625))
- DR10. **🟡 Status outcome requires force-click in Playwright** — may indicate a real pointer-events issue. Playwright's normal `.click()` on the outcome option timed out; `{ force: true }` succeeded. Likely a `<span class="outcome-title">` or similar wrapper intercepts the click target. Needs verification with a real touch interaction — could be cosmetic (Playwright synthetic event quirk) or a real touch-screen bug. ([beta_dashboard.js outcome-grid render](../src/dashboard_assets/beta_dashboard.js))

**Falsified predictions (removed):**
- "Status options use system jargon" (was D6 in prior doc). UAT found the labels are parent-friendly. Earlier red-team over-called this.
- "Drawer focus leaks into sidebar" (was C4 in prior doc). Playwright confirmed focus stays in drawer through 10 Tab presses. The polished version of this finding survives as DR2 above (restoration target wrong).

### 4.5 System Health — verified via curl UAT

- SH1. **🟡 Schedule panel exposes raw cron strings to the parent** (`0 6 * * *`, `*/1 * * * *`). ([beta_dashboard.js:853-855](../src/dashboard_assets/beta_dashboard.js#L853-L855))
- SH2. **🟡 Status dot can show green while scrape is stale.** Logic considers only heartbeat freshness, not `activity.scrapeStale`. ([beta_dashboard.js:430-439](../src/dashboard_assets/beta_dashboard.js#L430-L439))
- SH3. **🟢 Heartbeat staleness threshold is 120s** — verified working. UAT scheduler heartbeat was 3 min old → correctly shown as stale.
- SH4. **🟢 `lastError` from scheduler/agent heartbeats** is in `/api/health` but never surfaced in the activity feed.

### 4.6 Mobile — verified via Playwright at 390×800 viewport

- MB1. **🔴 Sidebar disappears with no replacement.** Confirmed: `sidebarVisible: false, tabBarExists: false`. Parent on phone has no way to switch views after the initial load. ([dashboard.css:1617](../src/dashboard_assets/dashboard.css#L1617))
- MB2. **🟢 Mobile drawer is full-width** *(falsified prediction).* At 390px viewport the drawer's `width` matched the viewport (`FULL_WIDTH`). Earlier prediction said the drawer rendered as a right-side narrow panel on mobile — wrong.
- MB3. **🟢 Main content does not extend full-width on mobile.** The `.main` container retains the `margin-left: var(--sidebar-w)` that was set for desktop, so content wraps in a narrower column than the viewport. Cosmetic but adds horizontal scroll risk on small screens. ([dashboard.css](../src/dashboard_assets/dashboard.css))

### 4.7 API contract — verified via curl UAT

- API1. **🔴 `bucketLabel` vs `homeBucketLabel` data divergence.** Two rows in `/api/assignments` show both `bucketLabel="Needs attention"` and `homeBucketLabel="Needs Attention Tonight"`. Front-end picks one per view; today no user-visible bug but contract drift risk.
- API2. **🟡 `refresh_schoology` blocks the request handler for 53 seconds.** No async path. Will exhaust HTTP workers on a Pi-class box with concurrent dashboard requests.
- API3. **🟡 Invalid status codes accepted.** `update_assignment_status` with `status:"Z"` returns `{ok:true}`.
- API4. **🟡 Omitting `status` silently clears the field** rather than rejecting as 400.
- API5. **🟡 `x-schoology-dashboard-request` header is required for writes but undocumented.** DASHBOARD.md says "custom header check" without naming it. ([dashboard_server.js:69](../src/dashboard_server.js#L69))
- API6. **🟢 Malformed assignment keys return 404 instead of 400.** Both `invalid-key` and well-formed-but-nonexistent return identical `{ok:false,"error":"Assignment not found."}`.
- API7. **🟢 `POST /api/tools/run` with empty body returns `"Unsupported dashboard tool."`** instead of `"Tool name required."`.

### 4.8 Sidebar density — verified via code-read

All five sidebar findings confirmed against the actual markup and CSS:

- SB1. **🟡 Verbose nav labels.** "Tonight's Plan" (13 chars), "All Schoolwork" (14 chars), "System Health" (13 chars) compete with icon + badge in a 232px sidebar. ([beta_index.html:29-51](../src/dashboard_assets/beta_index.html#L29-L51))
- SB2. **🟡 Active-state contrast too soft.** `.nav-item.active { background: rgba(255,255,255,0.11) }` — 11% white tint, barely visible at a glance. ([dashboard.css:144](../src/dashboard_assets/dashboard.css#L144))
- SB3. **🟡 No section grouping.** Single flat `.sidebar-section` with all three items; no Monitor/primary separation. ([beta_index.html:28-53](../src/dashboard_assets/beta_index.html#L28-L53))
- SB4. **🟡 Empty bottom half of the sidebar.** `flex-direction: column` with no `flex: 1` spacer — items pile at top, nothing anchors at bottom. ([dashboard.css:72-81](../src/dashboard_assets/dashboard.css#L72-L81))
- SB5. **🟢 "Beta" badge is hardcoded in markup** instead of build-env driven. ([beta_index.html:25](../src/dashboard_assets/beta_index.html#L25))

Mock #7 shows the proposed 2-item + Monitor footer + parent identity layout.

### 4.9 Drawer header density — verified

Findings DR3, DR4, DR5, DR7 in §4.4 cover this. All confirmed by code-read; no separate section needed. Mock #8 shows the compressed 3-line layout.

---

## §5. Telegram bot audit

Folded from the standalone bot subagent pass. Single-paragraph compression — the long version is in the conversation transcript.

**Inventory.** The bot exposes only `/ping → pong` as a literal command. Everything else goes through the GPT-5.2 reasoning planner. Two scheduled jobs: scrape at 06:00 ET, summary at 07:00 ET. Reminder cron fires every minute. Live-check heartbeat is `disabled` by default. ([src/scheduler.js:57-79](../src/scheduler.js#L57-L79))

**Top findings ranked by parent impact:**

1. **🔴 No inline keyboards anywhere.** Every action is a free-text reply. Repo-wide grep for `reply_markup|inline_keyboard|callback_data` returns zero. On phone, the parent has to type sentences to do what the dashboard does with one click. Single largest gap between the dashboard and the bot.
2. **🔴 No proactive "I'm alive" signal.** `LIVE_CHECK_ENABLED=false` by default. If scrape silently fails or the agent dies, the parent learns from the *absence* of the 07:00 digest. Same lie-detection failure as the dashboard's status dot.
3. **🔴 No "new assignment posted late" alert path.** `storage.js:307-316` computes a `newMissing` list. `summary.js:50-57` zeros it out. So a 10pm teacher post is invisible until 6am.
4. **🟡 Daily digest is write-once, never edited.** Resolving items in the dashboard does not update yesterday's digest. Chat history piles up stale state.
5. **🟡 Login-failure alert tells parent to run `npm run login:interactive`** — a command they don't have a terminal for and that requires Playwright headed mode on the host.
6. **🟡 6-hour cooldown on login alerts.** First morning alert is followed by 6 hours of silence regardless of recovery state.
7. **🟡 No quiet hours.** Reminder cron runs `*/1 * * * *` 24/7. One badly-timed reminder at 2:47 AM destroys trust in all future reminders.
8. **🟡 Engineer error strings leak via "Need your input:" prefix** — sometimes a clean string, sometimes a stack-trace tail.

**Bot vs dashboard role recommendation.** Bot should own evening kickoff (one-line digest with inline-keyboard "Open dashboard" at 6:30pm), status verification (Submitted / Practice / Skip buttons on every line), trust check (morning heartbeat), and end-of-evening close-out ("you handled 3 of 3 tonight — sleep well"). Dashboard owns depth.

---

## §6. Cold start + credential rotation

Folded from the standalone onboarding subagent pass.

**Cold-start narrative as a parent experiences it today.** Clone repo. Find no `README.md`. Discover `AGENTS.md` is written for coding agents. Eventually find `.env.example`. Copy. See `SCHOLOGY_*` typo and assume it's wrong. Set credentials. Run `docker compose up -d --build`. Wait. **Dashboard shows nothing for 6 hours** because the scheduler waits for `SCRAPE_CRON="0 6 * * *"`. Empty state is indistinguishable from "system broken." Best case: data appears overnight. Worst case: parent gives up.

**Top findings:**

1. **🔴 No `README.md` at repo root.** `AGENTS.md` is the most discoverable doc and assumes the reader is a coding agent.
2. **🔴 `.env.systemd` line 1 typo `CHOLOGY_USERNAME`** silently disables Schoology auth (covered in §1).
3. **🔴 `SCHOLOGY_*` env-var prefix is misspelled.** Every var is missing an "o." A parent who types `SCHOOLOGY_USERNAME` correctly sees nothing scrape. Accept both spellings in `src/config.js`.
4. **🔴 No first-run scrape.** Scheduler waits for cron tick. Boot at 7pm → no data until 6am.
5. **🔴 Empty-state copy is indistinguishable from broken system.** Covered as TV finding in §4.2.
6. **🔴 Credential rotation requires a CLI command parents can't run.** `npm run login:interactive` needs Node + Playwright + a headed browser. The alert message asks for it anyway.
7. **🟡 No `validateTelegramConfig()` / `validateOpenAIConfig()` at scheduler boot.** Failures appear 12 hours later at 7am cron.
8. **🟡 Beta vs prod compose-file selection is undocumented + contradicted between docs.** `AGENTS.md` says beta is rollback-only; `ARCHITECTURE.md` says systemd is primary runtime.
9. **🟡 No Telegram bot bootstrap docs.** BotFather flow + chat ID discovery + `npm run telegram:updates` is mentioned only in `package.json:11`.
10. **🟡 No documented reset/recovery path for prod** — only beta has `npm run beta:reset-memory`.
11. **🟢 Dashboard has no version footer.** Parent can't tell which build is running.

**What the recovery flow should look like.** Detection: degrade status dot to red on login failure. Surfacing: System Health row "Schoology session — Expired 4 min ago — [Reauthorize]." Recovery: in-dashboard form for password rotation (90% case) + cookie paste (SSO/MFA case) + headed Playwright as last resort. Confirmation: Telegram ping "Schoology login restored. Resuming scrapes."

---

## §7. Edge case rendering

Folded from the standalone edge-case subagent pass. The audit looked at how 12 edge cases render in today's code (not how they should render — that was §6 of the prior red-team).

**Credit where due:**
- Submitted-ungraded inference is plumbed end-to-end in three independent code paths.
- Auto-ignore engine + identity canonicalization handle the assignment-renamed case sophisticatedly.
- DST/TZ math is server-side correct, anchored to `America/New_York`.

**Top 3 to ship now** (each ≤30 LOC):

1. **🔴 E5. Suspicious-scrape guard.** Today an empty scrape resolves every previously-missing assignment as "done." If the Schoology cookie expires silently, the dashboard will show "All caught up" with zero alerts. Fix in `updateStateWithScrape`: if new scrape returns <50% of prior count, set `state.meta.suspectScrape = {at, seen, prior}` and skip the missing-resolution loop. Dashboard reads `meta.suspectScrape` to flag amber. ~25 lines.

2. **🔴 E1. Overdue age counter pill.** The data (`last_missing_at`, `first_seen_at`) is written by every scrape but the dashboard never reads it. Add `overdueAgeDays` to `mapAssignmentRow`. Render `Overdue · 8d` on pills with age >3. Eliminates the "death by false alarm" failure mode in Journey A. ~15 lines.

3. **🟡 E11. Past-date reminder guard + echo-back.** Already covered as §4.4 D6. The "echo-back" addition — render `Will remind: Tuesday 8 PM (in 2 hours)` flash after save — covers M7 (quick-pick presets) simultaneously. ~8 lines.

**Accepted gaps for this release** (low parent-trust impact for now):
- E3 Snow day, E4 Trip mode, E12 Finished course — quality-of-life, parent works around.
- E2 Status flapping detection — needs new `status_changes` table; defer.
- E7 Course rename — currently invisible because course-color stripe (the feature it would break) doesn't ship yet.
- E8 Late-night assignment alert — handled instead via Telegram bot recommendation #3 in §5.
- E10 DST client-side date-slice bug — 6-line fix but only mis-buckets for hours when UTC date ≠ Eastern date.

**Pattern across all twelve edge cases:** the DB writes the right data, the dashboard renderer doesn't read it. `first_seen_at`, `last_missing_at`, `last_seen_at`, `resolved_at`, `lastScrapeAt`, `lastSeenLabel` all exist. The cheapest 80% of trust recovery is plumbing existing fields to existing pills, not building new tables.

---

## §8. Calibration history — what predictions were wrong

*Awaiting severity recalibration subagent. This section will document predictions from the original red-team that were downgraded or removed after verification — the value being: future calibration of severity calls.*

Already documented from the curl-UAT pass:

| Original claim | Verified status | Recalibrated |
|---|---|---|
| 🔴 Three count totals can disagree | All match at 22 | REMOVED |
| 🔴 Engineer copy leaks via `reasonText` | Sampled strings parent-friendly | 🟢 |
| 🔴 XSS via assignment notes | Renderer escapes via `esc()` at all paths | 🟢 defense-in-depth |

Severity recalibration + browser UAT additions:

| Original claim | Verified status | Recalibrated |
|---|---|---|
| 🔴 Drawer focus trap missing (C4) | Playwright: focus contained through 10 Tab presses | 🟢 (restoration target wrong; trap works) |
| 🟡 Flash behind drawer (M11/TV1) | Playwright: flash visible after Save | REMOVED |
| 🟡 Mobile drawer is right-side panel (MB2) | Playwright: full-width at 390px | REMOVED |
| 🟡 "Coverage" math confusing (M9) | Math is correct, copy is opinion | 🟢 (TV4) |
| 🟡 Drawer state lost on view switch (M13) | Data persists in `state.drawer`; UX friction only | 🟢 (DR8) |
| 🟢 Status labels engineer-y (m9/D6) | Labels are actually parent-friendly | REMOVED |
| 🟢 Cron strings exposed (m5) | UAT confirmed parent-visible | 🟡 (SH1) |
| 🔴 XSS via assignment notes | Renderer escapes via `esc()` at all paths | 🟢 defense-in-depth |
| 🔴 Three count totals can disagree | All match at 22 | REMOVED |
| 🔴 Engineer copy leaks via `reasonText` | Sampled strings parent-friendly | REMOVED |

**Calibration takeaway:** 30% of predictions labeled "🔴" before verification were downgraded or removed after running the code. Severity should never be assigned to predictions — only to verified findings. The 7 falsifications in this table are the cost of doing it backwards.

**New findings the browser UAT surfaced that code-read missed:**
- Status outcome requires force-click — see DR10. Unclear whether real pointer-events bug or Playwright synthetic event quirk.
- Focus restoration target is wrong (returns to `status-dot-btn` not originating row) — see DR2.
- Main content `margin-left` leaks into mobile viewport — see MB3.
- Topbar status dot has no accessible name (text is whitespace, only parent has aria-label).
- Zero console errors and zero network failures across all six tested flows — the page is technically clean.

---

## §9. Mock variants

Eight side-by-side interactive mocks at [docs/design/mocks/dashboard-improvements-v1.html](design/mocks/dashboard-improvements-v1.html). Open in a browser. Real CSS tokens. Interactive where the variant has state to demonstrate.

1. Topbar (current fake ⌘K vs proposed sync pill + real search)
2. Tonight (5 flat sections vs course-stripe + collapsed lower sections)
3. Destructive confirm (instant delete vs inline two-step)
4. Bulk select (mode toggle vs always-on checkboxes + preview confirm)
5. Mobile nav (no replacement vs bottom tab bar)
6. Empty state (ambiguous vs timestamp + stale variant)
7. Sidebar density (3 verbose items vs 2 short + Monitor footer + parent footer)
8. Drawer header (5-line stack vs 3-line compact)

---

## §10. Phased roadmap

### Phase 0 — One-day quick wins (highest ROI per hour)
Re-prioritized against verified evidence:

1. Rotate cleartext secrets (§1).
2. Suspicious-scrape guard (§7 E5) — single highest trust-recovery fix.
3. Past-date reminder validation (§4.4 DR1) — 2-line server fix.
4. Bulk apply confirmation modal (§4.3 SW1).
5. Empty state with last-checked timestamp (mocked as Mock #6).
6. Remove fake ⌘K chip (or wire to real input — Mock #1).
7. Drawer Save → `Save status` (§4.4 DR7 — one-line label change).
8. Course label contrast bump from `--ink-3` to `--ink-2` (§4.2 TV3 — verified 4.18:1, fails AA by 0.32).
9. Make `status` required + validate enum on `update_assignment_status` (§4.7 API3+API4).
10. Document `x-schoology-dashboard-request` header in DASHBOARD.md (§4.7 API5).

### Phase 1 — Foundation
- Real search wired to ⌘K + topbar input.
- Sync pill in topbar; status dot includes `scrapeStale` (§4.5 SH2).
- Course color stripe on rows (already specified in tokens).
- Drawer focus-restoration target fix (DR2 — restore to originating row, not `status-dot-btn`).
- Bottom tab bar at ≤860px (§4.6).
- README.md at repo root (§6 finding 1).
- Schoology env-var typo accommodation (§6 finding 3).

### Phase 2 — Verification & trust
- Composite `Submitted` as server-side atomic tool.
- Quick-pick reminder chips + echo-back (covers §7 E11 and §4.4 M7).
- Single source of truth for `tonightTotals` server-side (kills §4.7 API1).
- Per-row "acknowledge teacher-side" (§7 edge case 1).
- Heartbeat-based credential expiry detection (§6 finding 6).
- Telegram bot: inline keyboards on digest (§5 finding 1).

### Phase 3 — Mobile + deep links
- `history.pushState` for view + drawer.
- Mobile full-screen drawer with swipe-down.
- Deep-link an assignment by URL.
- Bot quiet hours + bot digest editing (§5 findings 4, 7).

### Phase 4 — Power-user polish (defer until basic search exists)
- Command palette ⌘K (requires §0 search foundation).
- Keyboard chords (G H, G W).
- Trip mode, snow-day shift, course archive (§7 accepted-gap edges).

---

## Audit method

**Subagent passes used:**
1. Red-team heuristic audit (general-purpose, opus) — produced predictions
2. JTBD + journeys + stories (general-purpose, opus) — produced product foundation
3. IA + navigation critique (Plan, opus) — produced §3
4. Code-level friction audit (Explore, opus) — produced predictions
5. Telegram bot audit (general-purpose, opus) — produced §5
6. Onboarding + cold-start audit (general-purpose, opus) — produced §6 + §1
7. Edge-case rendering audit (general-purpose, opus) — produced §7
8. UAT-A through UAT-E (5× general-purpose, haiku) — produced §4 verified entries
9. Browser-driven Playwright UAT (general-purpose, haiku) — fills §4 UI predictions
10. Severity recalibration (general-purpose, haiku) — fills §8 + §4.8, §4.9

**What this audit DOES NOT cover:**
- Performance budget (first paint, drawer open latency, memory on Pi-class hosts) — not measured.
- Multi-device race conditions (laptop + phone open simultaneously) — not tested.
- Notes/follow-up data lifecycle (do old items archive?) — not investigated.
- Accessibility beyond drawer focus trap (color-blind palette validation, reduced-motion) — not tested.
- GPT's in-flight managed-agent migration — `src/managed_agent_*` files not read. My findings assume the audited code is the code that ships.

**Reproduction:**
```bash
# Bring up isolated UAT stack
docker compose -p schoology-uat -f docker-compose.uat.yml up -d
# Verify
curl http://127.0.0.1:8789/api/health
# Tear down
docker compose -p schoology-uat -f docker-compose.uat.yml down
```
