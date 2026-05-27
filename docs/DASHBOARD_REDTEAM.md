# Dashboard Red-Team — PM Foundation + UX Critique

Date: 2026-05-25
Scope: `src/dashboard_assets/beta_*` (primary) and `src/dashboard_assets/*` (prod) in the Schoology Bot repo.
Author: red-team synthesis from four parallel subagent passes — heuristic UX audit, JTBD/journeys, IA critique, code-level friction audit.
Companion artifact: [docs/design/mocks/2026-05-25-dashboard-improvements.html](design/mocks/2026-05-25-dashboard-improvements.html) — interactive side-by-side mocks of the top recommendations.

---

## TL;DR — what to fix and in what order

**The single highest-ROI change:** promote `Last synced N min ago` into the topbar, color it amber when stale, and contextually expose a "Refresh now" affordance when staleness is detected. The whole reason a parent opens the dashboard is to trust the data; today that trust signal is buried in a System Health sub-view.

### Top 5 critical issues
1. **The ⌘K search bar is fake** — visible chip with placeholder text, no input, no handler. Promises a power feature that doesn't exist. ([beta_index.html:65-69](../src/dashboard_assets/beta_index.html#L65-L69))
2. **Destructive actions delete instantly with no confirm, no undo, no audit** — `Remove reminder` / `Delete follow-up` / `Bulk apply` all fire on a single click. ([beta_dashboard.js:1938-1956](../src/dashboard_assets/beta_dashboard.js#L1938-L1956))
3. **Trust signals are buried** — `Last sync` only shows on the System Health view; the Tonight view (the daily landing) has no visible freshness signal. ([beta_dashboard.js:1225-1229](../src/dashboard_assets/beta_dashboard.js#L1225-L1229))
4. **Refresh button moved off Tonight with no contextual fallback** — per recent commit `d963e15`, the only Refresh button lives on System Health. When data looks stale on Tonight, there's no contextual path to refresh. ([beta_dashboard.js:1208-1212](../src/dashboard_assets/beta_dashboard.js#L1208-L1212))
5. **Mobile sidebar disappears entirely with no replacement nav** — at ≤860px the sidebar is `display: none` and no bottom tab bar is rendered. Mobile users on non-Tonight views can only navigate via browser back. ([dashboard.css:1614-1625](../src/dashboard_assets/dashboard.css#L1614-L1625))

### Top 5 quick wins
1. Bump course label contrast from `--ink-3` to `--ink-2` (one-line change, immediate scan-readability gain).
2. Collapse `Waiting on Teacher` and `Coming Up` by default on Tonight (the state machine exists, the chevron just isn't rendered).
3. Drop the duplicate metric row on Tonight — page header already says "3 items need attention."
4. Make drawer save labels parallel: `Save status` / `Save reminder` / `Save note`. Same fix surfaces section previews in the accordion heads (`Notes · 2`, `Reminder · not set`).
5. Remove the topbar breadcrumb (it shows only the current view name, redundant with the sidebar) and put the sync pill there instead.

### Sidebar + drawer (the two "open" surfaces)
- **Sidebar:** shrink labels to one word each (Today / Schoolwork), demote System to a Monitor footer row with the status dot inline, add a parent identity row, brighten the active state with a brand accent stripe. See §5.4.
- **Drawer header:** compress from 5 stacked lines to 3 (course chip + status on row 1, title on row 2, meta + sync time on row 3), move `reasonText` into the Status accordion body, surface section previews in accordion heads. See §5.5.

---

## 1. Product foundation

### 1.1 Product goal (single sentence)
**The dashboard exists so one working parent can confirm "tonight is handled" for their middle/high schooler's schoolwork in under three minutes, on whatever screen is in front of them.**

That sentence is the rubric. Every feature is judged by whether it shortens the path from "open the tab" to "close it with confidence."

### 1.2 Non-goals
1. Not a grade tracker — grades live in Schoology.
2. Not a notification center — Telegram is the push channel; the dashboard is the pull surface.
3. Not multi-student or multi-tenant — one child, one parent, no auth.
4. Not a calendar replacement — week view is planning context, not a full calendar app.
5. Not a kid-facing app.
6. Not a teacher communication tool.
7. Not an analytics product — no engagement charts, no "items completed this month."
8. Not a perfect mirror of Schoology — it interprets and buckets; Schoology is the source of truth.
9. Not a chat surface — no conversation pane.
10. Not a homework helper — no content, no tutoring.

### 1.3 Primary persona — The Working Parent
Mid-40s, full-time job with real meetings, one middle/high schooler whose Schoology credentials they technically have. Tech comfort: can run Docker if a one-liner is provided, but unwilling to debug at 9pm. They open the dashboard between 6–9pm with ~90 seconds of attention before something interrupts. They are optimizing for **peace of mind with the least possible effort**. They actively avoid alarmism, busywork, reading more than one row per assignment, and any flow that requires "go check Schoology" as a follow-up.

**They trust the system as long as the system tells them when it is broken.** They become hostile to the product the moment they catch it lying — a "Submitted" pill on something the kid didn't submit erodes more trust than three missed scrapes.

### 1.4 Jobs-To-Be-Done (ranked by frequency × importance)

| # | JTBD | Score |
|---|------|-------|
| 1 | **Evening triage** — when it's after-dinner on a weeknight, I want to see exactly what my kid still needs to do tonight, so I can decide what to nudge them about and close the laptop. | 25 |
| 2 | **Status verification** — when my kid claims they submitted something, I want to confirm Schoology actually has it. | 20 |
| 3 | **Mobile interrupt** — when I'm away from my desk and my kid texts a homework question, I want to pull up the assignment in two taps. | 16 |
| 4 | **System trust check** — when I haven't heard from the bot in a while, I want a one-glance signal that the scraper is alive. | 16 |
| 5 | **Stale-data sanity check** — when something looks wrong, I want to know when data was last fetched. | 15 |
| 6 | **Follow-up loop close** — when I previously promised "check back on the regrade," I want to see that task while triaging. | 12 |
| 7 | **Parent-to-kid escalation** — when something is sliding, I want to capture a concrete reminder tied to the assignment. | 12 |
| 8 | **End-of-evening close-out** — when I'm done triaging, I want a clear "you handled everything" signal. | 12 |
| 9 | **Weekly planning** — Sunday or Friday, I want to scan the next 7 days of workload. | 8 |
| 10 | **Note capture** — when I learn context ("teacher is sick"), I want to attach a one-line note. | 6 |

**Top three by score** — Evening triage, Status verification, Mobile interrupt. Day-to-day product quality is graded on those three. Everything else is supporting structure.

### 1.5 Anti-personas — who this is NOT for
1. **The Tiger Parent** — grade trends, percentile rankings, performance graphs. Building this turns the product into surveillance.
2. **The Multi-Kid Family CTO** — family rollups, multiple accounts. Adds auth, kills simplicity.
3. **The School Administrator** — admin tooling, teacher comms, attendance.
4. **The Teen Self-Managing User** — kid-facing planner. Kid has Schoology already.
5. **The Productivity Maximizer** — Pomodoros, focus modes, dependency graphs.
6. **The Notifications Power User** — email digests, Slack notifications, weekly PDFs. Push is Telegram's job.
7. **The SaaS Customer** — signup, billing, mobile app, cloud sync.
8. **The Open-Source Community Maintainer** — plugin systems, theming, i18n.

**Design drift signal:** if a feature would only make sense if there were more than one user, more than one kid, or more than one household, it's anti-persona pull. Reject or shelve.

---

## 2. Canonical user journeys

### Journey A — The Evening Ritual (defines the product)
**Trigger:** 6:47pm Tuesday. Parent cleared dinner dishes, kid is on a laptop in the next room.

1. Opens the bookmark. Sees "Good evening. 3 items need attention tonight." Red dot Overdue (1), amber Due Tonight (2). System dot green. **Feels:** mildly relieved.
2. Clicks the English row. Drawer slides in with last note. Adds a follow-up: "Check English outline before bed." Closes drawer.
3. Clicks the Science row — already submitted per Schoology. Flicker of "kid was telling the truth this time."
4. Walks to kid's room, asks about English outline, comes back, marks follow-up done.
5. Progress bar reads "3 of 3 resolved." Closes laptop.

**Success:** Tab closed within 3 minutes, no item left in ambiguity, no Schoology trip needed.

**Drop-off points:**
- Loads with 11 items in red → goes numb, bounces. (Design must avoid red-everything.)
- Drawer takes >400ms to open → distracted by Slack.
- Status verification requires a Schoology side-trip → abandons mid-flow.
- Same item shows "Overdue" three nights in a row (teacher-side delay) → learns to ignore Overdue entirely — death by false alarm.

### Journey B — Trust Recovery (when the bot seemed broken)
**Trigger:** 9pm Wednesday. Bot hasn't pinged in two days. Small lurch: "has the kid been missing things and I didn't know?"

1. Opens dashboard. Looks at status dot.
2. Dot is amber. Clicks it → System panel slides in.
3. Sees: Scheduler heartbeat 4h ago (stale). Telegram agent 2 days ago (down). Last scrape 2 days ago. **Feels:** validated, mildly annoyed they had to notice it themselves.
4. Hits "Refresh Schoology." Watches scrape complete. Last sync updates to "just now."
5. Tonight repopulates. One new overdue item appears. Acts on it.

**Success:** Parent regains confidence, recovers the missed signal, no school-day catastrophe.

**Drop-off points:**
- Status dot is green when system is actually broken → trust loss permanent when discovered.
- Refresh button buried → parent gives up and restarts Docker.
- System view is full of jargon (PID, heartbeat ages in seconds) → punished for checking.

### Journey C — Mobile Quick-Check
**Trigger:** 2:14pm Thursday. Between meetings. Kid texted "do u know when the lab is due."

1. Opens Tailscale URL on phone. Lands on Tonight. Lab isn't tonight.
2. Taps bottom tab "Work." Searches "lab" or scrolls to Science.
3. Sees "Science — Cell Membrane Lab — Due Friday 11:59 PM."
4. Texts kid back. Closes tab.

**Success:** Answered in <60s without opening Schoology mobile.

**Drop-off points:**
- Tailscale URL hangs → falls back to Schoology mobile.
- Desktop layout on phone → abandons.
- Search doesn't match partial keyword (kid said "lab" but title is "Cell Membrane Investigation") → has to scroll.

### Journey D — Weekend Planning (Sunday evening)
1. Lands on Tonight (default). Sees "This Week" mini-strip in right rail. Wednesday is the heavy day.
2. Clicks a Wednesday assignment → drawer. Sets a reminder for Tuesday 7pm.
3. Glances at the rest of the week. Closes the tab.

**Success:** One concrete reminder captured, no longer carrying the week in their head.

### Journey E — Quick verification after a kid claim
1. Kid says "I submitted the math thing." Parent opens dashboard, searches "math."
2. Math row shows status `Submitted (synced 14 min ago)`. Done in 20s.
3. Optionally adds a one-line note: "Confirmed with student 3/15."

---

## 3. User stories (acceptance-ready)

### Epic: Triage
1. **Default landing is Tonight** — bookmark → page lands on Tonight with urgency buckets populated within 1s.
2. **Single-sentence summary header** — reflects count of items in Overdue + Due Tonight and updates as items resolve.
3. **Urgency grouping** — Overdue, Due Tonight, Waiting on Teacher, Coming Up, Handled. Handled collapsed by default. Waiting/Coming Up collapsible.
4. **Course color stripe** — each unique course gets a stable color from a small palette, persisted across sessions.

### Epic: Plan
5. **Week-at-a-glance** — 7-day strip with dot-density per day; clicking a day scrolls to that day's items. Lives in Tonight's right rail (not a separate route — see §4).
6. **Forward/back navigation** — prev/next arrows shift the 7-day window.
7. **Assignment-attached reminder** — drawer reminder save persists a date/time; reminder appears on Tonight on its day.

### Epic: Verify
8. **Search assignments** — partial title and course name, debounced, returns within 200ms. Real, not a decorative chip.
9. **Per-assignment last-synced** — drawer shows timestamp; stale items (>12h) flag visibly.
10. **Note with timestamp** — drawer note saves with a timestamp; note appears in history on next open.
11. **Composite "Submitted" action** — writes status + confirmation note in one transaction; partial failures roll back.

### Epic: Follow up
12. **Standalone follow-up task** — `+ Add` creates a task with title and optional due date; appears in agenda.
13. **Mark done** — checkbox toggles complete; disappears from active list within the same render cycle.
14. **Overdue follow-ups surface as "Missed"** — tasks past their `remind_at` with status `pending` render in the Missed strip at the top of Tonight.

### Epic: Trust
15. **System status dot in topbar** — green if all heartbeats fresh and last scrape <6h; amber if any heartbeat stale or scrape 6–24h; red if down or scrape >24h.
16. **Manual refresh from System view** — kicks off scrape, shows in-progress state, updates last-sync on completion.
17. **Plain-English service health** — each row shows name, status word (OK / Stale / Down), last heartbeat in human time, one-line meaning.
18. **Never green when scraping is broken** — scraper staleness or last-scrape failure always degrades the dot to at least amber.

### Epic: Mobile
19. **Bottom tab bar at ≤860px** — Today, Schoolwork, Add. Sidebar hides. Badge counts shown.
20. **Drawer is full-screen sheet on phone** — 100vw / 90vh, slides up from bottom, dismissable by swipe-down or close button.

---

## 4. Recommended information architecture

The current sidebar has three top-level items: `Tonight's Plan`, `All Schoolwork`, `System Health`. The proposed design doc (`docs/DASHBOARD_DESIGN.md`) bumps that to four (`Tonight / This Week / All Schoolwork / System`). Both are over-built for the JTBDs.

**Recommendation: two top-level items + a system panel.**

```
Dashboard
├── Today                                  ← evening triage (daily, the 80%)
│   ├── Agenda (mixed: assignments + reminders, time-ordered)
│   │   ├── Overdue
│   │   ├── Missed reminders
│   │   ├── Tonight
│   │   ├── Waiting on teacher  (collapsed)
│   │   └── Coming up           (collapsed; surfaces tomorrow)
│   └── Right rail
│       ├── Week-at-a-glance (7-day mini strip)
│       └── (System status moves to topbar)
│
├── All Schoolwork                         ← verification ("is the essay in?")
│   ├── Search + filter
│   ├── Needs attention
│   ├── Waiting on school
│   └── Handled for now (collapsed)
│
└── (no third top-level item)

Cross-cutting
├── Topbar
│   ├── Search (real ⌘K, not decorative)
│   ├── Sync pill            ("Synced 12m ago" or "Stale — refresh")
│   ├── System status dot    → opens System panel (not a route)
│   └── "+ Add"              → unified create (reminder | follow-up)
│
├── Review drawer (right side, full-screen on mobile)
│
└── System panel (slide-in, not a route)
    ├── Services + last sync
    ├── Refresh Schoology
    └── "Open full system page" → optional deep route for File State / Docs
```

**Why not "This Week" as a top-level item?** The Sunday-planning JTBD scores 8/25. A full route for a once-a-week need duplicates information already on Tonight. Start with the mini-strip in Tonight's right rail; only graduate to a full route if forward data justifies its own URL.

**Why demote System?** Trust check is a *glance*, not a *destination*. The status dot in the topbar is the entry; the panel is the depth. Promoting it to a route makes it look like the parent should visit it regularly. They shouldn't.

**Reminders vs follow-up tasks** — these are two different data objects today (`/api/assignments/:key` with embedded reminder vs `/api/tasks` standalone). The UI should unify them visually on the Today agenda (the parent doesn't care about the object distinction at scan time), but distinguish them in the drawer (assignment-linked items open the full assignment drawer; standalone tasks open a simpler reminder drawer). A small course chip on assignment-linked items makes the drawer-opening predictable.

---

## 5. Red-team findings — prioritized

### 5.1 🔴 Critical (blocks core JTBD or breaks trust)

**C1. The ⌘K search box is fake.** `<div class="topbar-search">` with text "Search assignments…" and a `⌘K` chip. No input element, no click handler, no keydown listener. ([beta_index.html:65-69](../src/dashboard_assets/beta_index.html#L65-L69))
*Why it hurts:* Cargo-cult affordance. Promises the Command Palette from `DASHBOARD_DESIGN.md` §Key Interaction Patterns. Parent who tries it once assumes the dashboard is broken.
*Fix:* Wire as a real input that filters assignments and jumps to Schoolwork view. Or remove the placeholder + kbd chip until Phase 4 ships. Don't ship dishonest affordance.

**C2. Destructive actions delete instantly with no confirm, no undo, no audit.** `Remove` (reminder) at [beta_dashboard.js:1431](../src/dashboard_assets/beta_dashboard.js#L1431) and `Delete` (follow-up) at [beta_dashboard.js:1485](../src/dashboard_assets/beta_dashboard.js#L1485) fire `runTool("delete_*")` immediately on click.
*Why it hurts:* A misclick on the small `.beta-remove-link` (underline text-button next to Save) loses a hand-typed follow-up note. Trust collapses on the second occurrence.
*Fix:* At minimum, 5-second flash with "Undo" (re-create from in-memory snapshot). Better: two-step inline confirm (`Delete?` → `Yes, delete`). Bulk apply also needs a confirm with item count + chosen status.

**C3. "Last sync" trust signal is buried and inconsistent.** The big `sync-bar` ("Heartbeat live · Last scrape: X ago") only renders on System Health. On Tonight, sync info hides inside a "Recent Activity" panel below Reminders/Overview, often requiring scroll. ([beta_dashboard.js:1225-1229](../src/dashboard_assets/beta_dashboard.js#L1225-L1229), [beta_dashboard.js:831-850](../src/dashboard_assets/beta_dashboard.js#L831-L850))
*Why it hurts:* The whole reason the parent visits is "is this data current?" — the answer takes 3+ seconds and a scroll. The System Gut-Check JTBD is unmet.
*Fix:* Promote `lastScrapeAgeLabel` into the topbar next to the status dot ("● Synced 12 min ago"). Color amber if `activity.scrapeStale === true`. **Highest-ROI change in this entire document.**

**C4. Drawer has no focus trap and the background is not `inert`.** Drawer sets `aria-modal="true"` but Tab cycles back into the sidebar and topbar; backdrop button blocks clicks but not Tab. ([beta_index.html:118-130](../src/dashboard_assets/beta_index.html#L118-L130), [beta_dashboard.js:481-494](../src/dashboard_assets/beta_dashboard.js#L481-L494))
*Why it hurts:* Keyboard / screen-reader users will leak focus into the sidebar and start switching views while mid-edit.
*Fix:* When `data-open="true"`, set `inert` on `.sidebar`, `.topbar`, `.content`; trap Tab at the drawer boundary; restore on close. The `restoreFocus` machinery exists ([beta_dashboard.js:1586-1607](../src/dashboard_assets/beta_dashboard.js#L1586-L1607)) — just missing the trap.

**C5. Refresh Schoology is hidden on a sub-view with no contextual fallback.** Per recent commit `d963e15`, Refresh moved to System Health. The freshness *signal* didn't go with it. ([beta_dashboard.js:1208-1212](../src/dashboard_assets/beta_dashboard.js#L1208-L1212))
*Why it hurts:* Evening ritual breaks when parent sees stale data and instinctively reaches for Refresh — it's not there.
*Fix:* Keep button on System Health AND expose contextual "Refresh now" inside the topbar sync pill when `activity.scrapeStale` is true.

**C6. Mobile sidebar disappears with no replacement.** At ≤860px, `.sidebar { display: none; }` and nothing replaces it. No bottom tab bar (despite being explicitly designed in `DASHBOARD_DESIGN.md` §Mobile Layout). ([dashboard.css:1614-1625](../src/dashboard_assets/dashboard.css#L1614-L1625))
*Why it hurts:* Mobile parent on non-Tonight view can only navigate via browser back. Breaks the Mobile Interruption JTBD.
*Fix:* Build the `.bottom-tabbar` from the design doc. Phase 1 work that hasn't shipped.

**C7. Empty state can't distinguish "all done" from "system silently broken."** When `tonightCount === 0`, "All caught up — nothing needs attention tonight." Same message whether the bot just synced and the kid did everything, or the scraper hasn't run today. ([beta_dashboard.js:937-949](../src/dashboard_assets/beta_dashboard.js#L937-L949))
*Why it hurts:* Compounds C3 — parent can't tell whether to relax or worry.
*Fix:* Empty state embeds a timestamp: "All caught up — last checked Schoology 8 minutes ago." Different text + amber dot if `scrapeStale`.

### 5.2 🟡 Major (meaningful friction, fix soon)

**M1. Tonight pane is 5 flat sections with no scan-friendly hierarchy.** All sections use identical typography (11.5px uppercase header, 7px dot). Only differentiator is dot color. ([beta_dashboard.js:998-1051](../src/dashboard_assets/beta_dashboard.js#L998-L1051))
*Fix:* Implement course-color left stripe (the design doc already specifies six tokens); bump overdue rows one font-weight; collapse Coming Up by default to a count chip.

**M2. "Coming Up" and "Waiting on Teacher" don't collapse on Tonight.** `state.homeExpandedSections` and `toggle-home-section` handler both exist ([beta_dashboard.js:54-58](../src/dashboard_assets/beta_dashboard.js#L54-L58), [beta_dashboard.js:2081-2087](../src/dashboard_assets/beta_dashboard.js#L2081-L2087)), but the Tonight panel never renders the chevron and section headers aren't buttons.
*Fix:* Wrap section headers in `<button data-action="toggle-home-section">`. Respect `state.homeExpandedSections`. Default to collapsed.

**M3. "Action Required" metric duplicates the page subtitle.** Metric row says "Action Required: 3 tonight need attention" directly above page header "Good evening. / 3 assignments and 1 reminder need attention tonight." Then panel shows "4 items." Three different totals for the same idea, on the same fold. ([beta_dashboard.js:441-478](../src/dashboard_assets/beta_dashboard.js#L441-L478), [beta_dashboard.js:972-986](../src/dashboard_assets/beta_dashboard.js#L972-L986))
*Fix:* Drop the metric row on Tonight. Keep the page-header sentence.

**M4. Bulk select has no guard rail on "apply to N items."** `Apply` button fires `bulk_update_assignment_statuses` against every selected key with no confirm, no preview. ([beta_dashboard.js:1148-1162](../src/dashboard_assets/beta_dashboard.js#L1148-L1162), [beta_dashboard.js:1865-1881](../src/dashboard_assets/beta_dashboard.js#L1865-L1881))
*Fix:* `Apply 'Excused' to 20 items?` modal-confirm. First click previews, second confirms.

**M5. "Submitted" composite is non-atomic and surfaces engineer-y errors.** If note succeeds and status fails (or vice versa), user sees `Submitted partially applied: status set to waiting on teacher. note failed: ...`. Item moved buckets but audit note didn't save. ([beta_dashboard.js:1806-1836](../src/dashboard_assets/beta_dashboard.js#L1806-L1836))
*Fix:* Server-side composite tool that wraps both writes. If partial, offer "Retry the note" button inline, not raw error text.

**M6. No retry / actionable copy when the API is down.** If `/api/home` returns 500, flash shows `Request failed (500)` and the homepage stays on `Loading your after-school plan...`. ([beta_dashboard.js:163-170](../src/dashboard_assets/beta_dashboard.js#L163-L170), [beta_dashboard.js:2231-2233](../src/dashboard_assets/beta_dashboard.js#L2231-L2233))
*Fix:* Catch + render empty-state with Retry button and "Can't reach the bot. The Schoology container may need a restart."

**M7. Datetime-local is a poor reminder picker.** No "Tomorrow 4 PM," "After school," "Sunday evening" presets — even though `nextSchoolDayValue` ([beta_dashboard.js:314-323](../src/dashboard_assets/beta_dashboard.js#L314-L323)) knows the concept. ([beta_dashboard.js:1419](../src/dashboard_assets/beta_dashboard.js#L1419), [beta_dashboard.js:1511](../src/dashboard_assets/beta_dashboard.js#L1511))
*Fix:* Prepend 3-4 quick-pick chips ("In 1 hour," "Tomorrow 4 PM," "Sun 7 PM"). Keep picker for power-edits.

**M8. Three different totals for "what's tonight" can disagree.** Metric uses `summary.tonightCount`; subtitle uses `tonightRows.length`; progress bar uses yet a third combination. ([beta_dashboard.js:443-447](../src/dashboard_assets/beta_dashboard.js#L443-L447), [beta_dashboard.js:977-984](../src/dashboard_assets/beta_dashboard.js#L977-L984), [beta_dashboard.js:1056](../src/dashboard_assets/beta_dashboard.js#L1056))
*Fix:* Compute single `tonightTotals` server-side; use everywhere.

**M9. "Coverage this session" math is unmotivating.** Right-column bar uses `(handled + waiting) / totalMissing` — mostly yesterday's waiting items. Reads "67%" that doesn't reflect tonight's work. ([beta_dashboard.js:809-811](../src/dashboard_assets/beta_dashboard.js#L809-L811))
*Fix:* Remove from right column. Keep only the in-context "Tonight's progress" bar that uses session-resolved math.

**M10. Course label is the lowest-contrast text on the row.** `--ink-3` (#767c8a) at 12px on white ≈ 3.7:1 — borderline non-compliant on Tailscale-over-5G screens. It's the most useful triage signal (which subject?). ([dashboard.css:719-723](../src/dashboard_assets/dashboard.css#L719-L723))
*Fix:* Bump to `--ink-2` (#3f4452) at 13px, or implement course color stripe.

**M11. Flash messages can render behind the drawer.** Drawer overlays the flash slot ([beta_index.html:83](../src/dashboard_assets/beta_index.html#L83)). User submits status update, success flash fires, but it's hidden behind backdrop.
*Fix:* Render flash inside drawer when drawer open; or move flash to a fixed top-of-viewport position with higher z-index than drawer.

**M12. Bulk select state persists across view switches.** `state.bulkMode` and `state.selectedAssignmentKeys` persist when navigating away. Returning later, parent may apply status to forgotten selections. ([beta_dashboard.js:51-53](../src/dashboard_assets/beta_dashboard.js#L51-L53))
*Fix:* Clear `bulkMode` on view-switch away from Schoolwork.

**M13. Drawer state lost on view switch.** Clicking sidebar while drawer open keeps drawer mounted but the row it was opened from is no longer visible. No breadcrumb back. ([beta_dashboard.js:496-501](../src/dashboard_assets/beta_dashboard.js#L496-L501))
*Fix:* Closing drawer should restore the view + scroll position the drawer was opened from.

**M14. No deep links.** `state.activeView` is in-memory only. Refresh always lands on Today. Can't share an assignment URL. ([beta_dashboard.js:50](../src/dashboard_assets/beta_dashboard.js#L50))
*Fix:* `history.pushState` on view switch and drawer open; parse on init.

**M15. Mobile back button does nothing meaningful.** No `pushState` on drawer open → OS back gesture exits the app rather than closing the drawer.
*Fix:* Push a history entry on drawer open; pop on close.

### 5.3 🟢 Minor (polish)

- **m1.** `Add follow-up` topbar button is brand-blue primary on every view — wrong scope. Demote to ghost. ([beta_index.html:75-78](../src/dashboard_assets/beta_index.html#L75-L78))
- **m2.** Topbar breadcrumb is one item, redundant with sidebar. Replace with the sync pill. ([beta_dashboard.js:293-301](../src/dashboard_assets/beta_dashboard.js#L293-L301))
- **m3.** Drawer Status save says just `Save`; should be `Save status` to match the other two scoped save labels. ([beta_dashboard.js:1407](../src/dashboard_assets/beta_dashboard.js#L1407))
- **m4.** "Reminder" vs "Follow-up" used interchangeably — pick one noun. Reminder card eyebrow says "Follow-up" but the panel above says "Upcoming Reminders." ([beta_dashboard.js:682-683](../src/dashboard_assets/beta_dashboard.js#L682-L683))
- **m5.** Schedule panel exposes raw cron strings to a parent. Render human ("Weekdays at 4 PM") server-side. ([beta_dashboard.js:852-857](../src/dashboard_assets/beta_dashboard.js#L852-L857))
- **m6.** `aria-live="polite"` on the entire drawer announces full drawer body on every save. Drop it; leave it only on the `#flash` slot. ([beta_index.html:118-130](../src/dashboard_assets/beta_index.html#L118-L130))
- **m7.** Hover-only quick actions (per `DASHBOARD_DESIGN.md` §Row Hover Reveals) — not implemented at all. Touch users won't get them; need a tap-equivalent path.
- **m8.** "Reminders Today: 0 missed / due today" microcopy parses ambiguously. Separate sentences.
- **m9.** Outcome labels mostly OK, but internal manual statuses ("Practice / not for grade," "No way to fix it") read as engineer copy. Translate at render. ([beta_dashboard.js:18-26](../src/dashboard_assets/beta_dashboard.js#L18-L26))
- **m10.** Datetime input with no quick presets risks DST off-by-one bugs ([beta_dashboard.js:1511](../src/dashboard_assets/beta_dashboard.js#L1511)) — addressed by M7 above.
- **m11.** Notes count chip is faint and non-clickable. Make it a deep-link into the Notes accordion. ([beta_dashboard.js:624](../src/dashboard_assets/beta_dashboard.js#L624))
- **m12.** Reminder indicator chip on row not clickable to deep-link to the Reminder accordion. Same fix pattern. ([beta_dashboard.js:625](../src/dashboard_assets/beta_dashboard.js#L625))

### 5.4 Sidebar density (when open)

The sidebar is always-visible at desktop sizes — every parent looks at it constantly. It has three concrete clutter problems.

**S1. Verbose labels.** "Tonight's Plan," "All Schoolwork," "System Health" are all two-word labels. At 232px sidebar width with icon + label + badge competing for the row, they crowd the space and "System Health" reads as a destination when it's a glance. ([beta_index.html:29-52](../src/dashboard_assets/beta_index.html#L29-L52))
*Fix:* Rename to "Today," "Schoolwork," and demote System out of the primary list (see S3).

**S2. Active-state contrast is too soft.** `.nav-item.active { background: rgba(255,255,255,0.11) }` — barely visible against the dark sidebar at quick glance. With "Tonight's Plan" as the default landing view, the parent should always know which view they're on without thinking. ([dashboard.css:144](../src/dashboard_assets/dashboard.css#L144))
*Fix:* Add a 3px brand-color accent stripe on the left edge of the active item, and bump the background tint to `rgba(91,99,245,0.18)` (brand-tinted, not white-tinted).

**S3. No visual grouping; System sits at peer level with daily destinations.** The design doc anticipated this — `DASHBOARD_DESIGN.md:84-89` shows a Monitor section divider. Currently the sidebar has one flat `.sidebar-section` containing all three items. ([beta_index.html:28-53](../src/dashboard_assets/beta_index.html#L28-L53))
*Fix:* Split into two sections — primary nav (Today, Schoolwork) at top, then a `Monitor` footer with a System status row showing the dot + "All services OK · 12m ago" inline. This also surfaces the trust signal in the sidebar without forcing a route visit.

**S4. Empty bottom half of the sidebar.** The container is `flex-direction: column` with no `flex: 1` spacer, so on tall windows the items pile at the top and the lower half is unused. ([dashboard.css:72-81](../src/dashboard_assets/dashboard.css#L72-L81))
*Fix:* Insert a `.sidebar-spacer { flex: 1 }` after the primary nav so the Monitor row + parent identity row anchor to the bottom — gives the sidebar an intentional silhouette and a place for future help/settings affordances.

**S5. "Beta" badge in the logo row.** Acceptable on beta but the same partial component ships in prod with a different badge. Make the badge optional, driven by build env, not hardcoded. ([beta_index.html:25](../src/dashboard_assets/beta_index.html#L25))
*Fix:* Single source of truth for the badge text, swap via template variable so the sidebar is identical between prod and beta except for the chip.

### 5.5 Drawer header density (when open)

When a parent clicks an assignment row, the drawer slides in. The first thing they see is **five stacked lines** before any action button is visible: eyebrow (course) → title → status pill + middot + due date → "Open in Schoology" link → optional `reasonText` engineer-y blurb. By the time the eye reaches the Status accordion, vertical scroll on a 13" laptop is already engaged. ([beta_dashboard.js:1382-1397](../src/dashboard_assets/beta_dashboard.js#L1382-L1397))

**D1. Five-line header for a one-glance JTBD.** The parent's question on opening the drawer is "what's the state, and what do I do?" — the header front-loads context the row has already conveyed.
*Fix:* Compress to three lines:
1. Course chip (using same hash color as Tonight's row stripe) + status pill on the right.
2. Assignment title.
3. Meta strip: `Due tonight · 11:59 PM • Synced 14m ago • Schoology ↗`

**D2. `· · ·` middot separators feel cramped.** ([beta_dashboard.js:1393](../src/dashboard_assets/beta_dashboard.js#L1393))
*Fix:* Use bullet (`•`) with a faded color (`--ink-3`), or stack the meta items with a small gap and no separator.

**D3. The `reasonText` blob is engineer dump.** "Reason: missing per Schoology · last seen by scraper 14 minutes ago · category=Major Writing" reads like a log line. ([beta_dashboard.js:1397](../src/dashboard_assets/beta_dashboard.js#L1397))
*Fix:* Move into the Status accordion body as a secondary detail. If truncated to 100 chars (current behavior), surface the rest behind a "Show details" toggle.

**D4. Section labels don't preview their content.** Today the accordion heads just say `Reminder` and `Notes`. Whether there's a reminder set or how many notes exist is hidden until you expand. ([beta_dashboard.js:1412](../src/dashboard_assets/beta_dashboard.js#L1412), [beta_dashboard.js:1437](../src/dashboard_assets/beta_dashboard.js#L1437))
*Fix:* Append a quick preview to the section title: `Reminder · not set` / `Reminder · Tue 7pm`, `Notes · 2` / `Notes · empty`. The data is already computed for the closed-state `value` text — promote it into the heading.

**D5. Save button labels aren't parallel.** Three accordions, three save buttons: `Save` (status), `Set reminder` / `Update`, `Add note`. Each names a different verb. ([beta_dashboard.js:1407](../src/dashboard_assets/beta_dashboard.js#L1407), [beta_dashboard.js:1432](../src/dashboard_assets/beta_dashboard.js#L1432), [beta_dashboard.js:1452](../src/dashboard_assets/beta_dashboard.js#L1452))
*Fix:* Make them parallel: `Save status`, `Save reminder` (with `Remove` as the negative action for an existing reminder), `Save note`. Helps screen readers and reduces cognitive load.

**D6. Status options use system jargon.** `Practice / not for grade`, `No way to fix it`, `No grade put in yet`. ([beta_dashboard.js:18-26](../src/dashboard_assets/beta_dashboard.js#L18-L26))
*Fix:* Translate at render: `Practice only`, `Skip — can't recover`, `Grade not posted yet`. Server enum stays stable.

**D7. Per-assignment freshness is missing.** The drawer is exactly where the parent verifies status, but there's no "this row was last refreshed N minutes ago" inside the drawer. ([beta_dashboard.js:1388-1397](../src/dashboard_assets/beta_dashboard.js#L1388-L1397))
*Fix:* Add `Synced 14m ago` to the meta strip. Stale items (>12h) flag amber.

**D8. `aria-live="polite"` on the entire drawer.** Every render re-announces the full drawer body. ([beta_index.html:118-130](../src/dashboard_assets/beta_index.html#L118-L130))
*Fix:* Drop `aria-live` from `<aside class="drawer">`. The flash slot already has it.

### 5.6 Beta-vs-prod divergence
- Beta drawer (accordion, snapshot/restore) is materially better than prod's (`Edit`/`Editing` labels, no snapshot). Backport `captureDrawerSnapshot` / `restoreDrawerSnapshot` and `assignmentDrawerRequestSeq` to prod, OR retire prod once beta stabilizes.
- Both share the fake ⌘K, missing focus trap, no-confirm deletes, missing bottom tab bar — these are **global problems**, not beta bugs.

---

## 6. Edge cases the product under-serves

Real situations that break trust if mishandled:

1. **Fake-overdue from teacher-side delay.** Assignment past due but teacher hasn't collected. Dashboard nags parent nags kid; kid says "teacher didn't take it." Trust erodes.
   *Fix:* Per-row "acknowledge teacher-side" that suppresses from Tonight Overdue for 7 days while keeping visible in Schoolwork.

2. **Status flapping after a regrade.** Schoology returns inconsistent signals across runs.
   *Fix:* Track status transitions; flap >2× in 48h → "Status unstable — verify in Schoology."

3. **Snow day / half day.** Assignments due today aren't actually due.
   *Fix:* Mark day as closure in This Week; assignments shift visible due-date with a "closure-shifted" badge.

4. **Kid on a school trip / sick day.** Pre-excused or impossible.
   *Fix:* Trip mode — parent sets range, assignments tagged "kid away," excluded from Overdue.

5. **Schoology cookie expired.** Scraper running, returning empty results.
   *Fix:* If assignment count drops >50% in one scrape, flag scrape suspicious and degrade status dot to amber: "Last scrape returned far fewer assignments than expected — credentials may have expired."

6. **Schoology shows an assignment that doesn't apply.** Whole-class or wrong-section leaks.
   *Fix:* Per-row "hide / not for my kid" sending the row to an ignored bucket.

7. **Course renamed mid-semester.** Color hash flips; reads as new course.
   *Fix:* Key course identity off Schoology's course ID, not display name. Show "renamed from X" for one week.

8. **Late-night assignment posted.** 10pm teacher post; next scrape 7am; parent finds out on bus.
   *Fix:* Configurable evening pass (8pm + 10pm). Telegram ping for any new assignment due <24h.

9. **Submitted-but-not-graded ambiguity.** Title text "(Graded: <date>)" misread as graded.
   *Fix:* Never assert "graded" from title text; only from per-student grade signal. Already partially in `DASHBOARD.md`; promote to UI rule.

10. **DST / timezone drift.** Dashboard in one TZ, phone in another via Tailscale.
    *Fix:* All due-date logic anchored to school's local timezone, not device.

11. **Reminder set in the past due to clock skew.** datetime-local parses to wrong TZ → silent no-show.
    *Fix:* Echo back "Will remind: Tuesday 8pm (in 2 hours)" before save (covers M7 too).

12. **Graduated / finished course still listed.** Eats scan space.
    *Fix:* Auto-archive courses with no new assignments for 30 days, parent-confirm.

---

## 7. Success / failure metrics

This is a single-user product, so metrics are observational and qualitative. The parent is the instrument.

### Working
- **Evening session ≤ 3 minutes** median (laptop/tab close, or 5+ min inactivity).
- **Items-touched-per-session: 1-3 drawer opens, 0-2 status writes, 0-1 follow-ups.**
- **Mobile session ≤ 60 seconds** when answering a kid question.
- **Zero "was the bot down?" moments** — parent learns about outages from the dashboard, never from a kid surprise or report card.
- **One reminder per Sunday session.**
- **Trust holds after a regrade event.**

### Failing
- **Doom-scrolling Schoology** more than once a week — dashboard ceding its job.
- **Tab closed in <5 seconds** — alarmism or apathy.
- **Stale data not surfaced** — discovered after the fact.
- **Follow-ups accumulate unfinished** — task graveyard.
- **Two-week usage gap** without a school break.
- **Kid conversation driven by wrong data, even once a quarter.**
- **Mobile session abandoned mid-flow** in favor of Schoology mobile.

### Instrumentation (lightweight, single-user)
Local-only session log in `data/agent.log` style recording view loaded, drawer opens, status writes, follow-up creates. No external analytics. Reviewed quarterly.

---

## 8. Phased roadmap

### Phase 0 — One-day quick wins (highest ROI per hour)
- Promote sync pill into topbar (replaces breadcrumb). C3.
- Remove the fake ⌘K placeholder + chip until search is wired. C1.
- Confirm before destructive actions (inline two-step). C2.
- Collapse Coming Up / Waiting on Teacher by default on Tonight. M2.
- Drop the metric row on Tonight. M3.
- Course label contrast bump. M10.
- Drawer save → `Save status` scoping. m3.

### Phase 1 — Foundation
- Real search wired to ⌘K + topbar input. C1.
- Topbar `Refresh now` affordance when stale. C5.
- Course color stripe on rows. M1.
- Drawer focus trap + `inert` on background. C4.
- Bottom tab bar at ≤860px. C6.
- Empty state with last-checked timestamp. C7.

### Phase 2 — Verification & trust
- Composite `Submitted` as server-side atomic tool. M5.
- Quick-pick reminder chips. M7.
- Single source of truth for `tonightTotals`. M8.
- Per-row "acknowledge teacher-side." Edge case 1.
- Scrape-suspicious detection. Edge case 5.

### Phase 3 — Mobile + deep links
- `history.pushState` for view + drawer. M14, M15.
- Mobile full-screen drawer with swipe-down. Story 20.
- Deep-link an assignment by URL.

### Phase 4 — Power-user polish (defer)
- Command palette ⌘K — only after C1's basic search exists. Power-user feature for a single-user app; weak justification.
- Keyboard chords (G H, G W). Defer until ⌘K is real.
- Trip mode, snow-day shift, course archive. Edge cases 3, 4, 12.

---

## Companion: interactive mocks

The six highest-impact recommendations are rendered as side-by-side `current vs proposed` mocks in [docs/design/mocks/2026-05-25-dashboard-improvements.html](design/mocks/2026-05-25-dashboard-improvements.html). Open it in a browser — uses the project's real CSS tokens.

Mocks included:
1. **Topbar** — current (fake ⌘K, redundant breadcrumb) vs proposed (real search, sync pill, status dot opens panel).
2. **Tonight** — current (5 flat sections, dense, no scan hierarchy) vs proposed (course stripes, collapsed Coming Up/Waiting, contextual stale prompt).
3. **Destructive confirm** — current (instant delete) vs proposed (inline two-step).
4. **Bulk select** — current (mode toggle, dangerous Apply) vs proposed (row checkbox + confirm with count + status preview).
5. **Mobile nav** — current (sidebar hidden, no replacement) vs proposed (bottom tab bar with badges).
6. **Empty state** — current (ambiguous "all caught up") vs proposed ("All caught up — last checked 8m ago" + amber if stale).
7. **Sidebar density** — current (3 verbose items, weak active state, empty bottom) vs proposed (2 short items + Monitor footer with System status row + parent footer).
8. **Drawer header** — current (5-line stack with reason dump) vs proposed (3-line compact header with course chip + sync time + parallel save labels).
