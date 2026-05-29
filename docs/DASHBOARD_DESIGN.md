# Dashboard Design Plan

> **Superseded for prioritization by [`docs/DASHBOARD_AUDIT.md`](DASHBOARD_AUDIT.md) (2026-05-28).** This document remains useful as the original product-design rationale (personas, journeys, view sketches), but the Phase 1-5 numbering here is no longer the work plan. Current dashboard direction, verified findings, and priority tiers live in the audit; mocks live at `docs/design/mocks/dashboard-improvements-v1.html`.

A product-design-first document. Start here before writing implementation tickets.

---

## Who Is This For

One primary user: **a working parent** checking in on their middle or high schooler's Schoology assignments after school, usually at home in the evening on a laptop or phone.

Secondary scenario: **quick mobile check** from work, car, or couch via Tailscale URL.

---

## User Stories

### The Evening Ritual (highest frequency, most important)
> "I just got home. Show me what needs to happen tonight — fast."

- Parent opens dashboard at 5–8 PM
- Wants to see urgency at a glance: overdue first, due tonight second
- Does NOT want to read — wants to scan
- Will click 1–3 items to open the drawer and update status
- Wants to feel like they've "handled" the evening in < 3 minutes

### The Weekly Sweep
> "It's Sunday. Let me see what's coming and whether we're set."

- Scans the full week ahead by day
- Might add reminders for upcoming heavy deadlines
- Wants to catch things due Mon/Tue before the school week starts

### The Status Check
> "My kid says the essay is submitted. Is it actually in Schoology?"

- Looks up a specific assignment by name or course
- Reads last status, notes, and submitted date
- May update manually with a note: "Confirmed with student"

### The Follow-up Loop
> "I told myself I'd check if the quiz grade posted. What did I set up?"

- Reviews pending follow-up tasks
- Marks done or reschedules
- Creates new ones from the drawer when reviewing an assignment

### The System Gut-Check
> "The bot hasn't messaged me today. Is it broken?"

- Wants a quick signal: green = fine, red = something's off
- Does NOT need a full admin panel for this — a status badge in the header suffices
- Goes deeper only if something is yellow/red

### Mobile Interruption
> "Kid texted me a question about something due tomorrow. Let me pull it up real quick."

- One-handed phone use
- Single tap to find the assignment
- Drawer should be full-screen on mobile, not a panel

---

## Design Principles

1. **Scan first, click second.** The most critical information — what's urgent, how many items — must be readable without opening anything.
2. **Calm, not clinical.** A parent managing a kid's homework shouldn't feel like they're triaging a hospital. The visual tone should feel organized and trustworthy, not alarming.
3. **Mobile is first-class.** Not an afterthought. The sidebar collapses to a bottom tab bar on mobile. Drawers go full-screen.
4. **One job per view.** Tonight → action. Week → planning. All work → reference. Health → confidence. Each view has one clear purpose.
5. **Progressive disclosure.** Rows show summary. Drawers show detail. No nesting beyond two levels.
6. **Writes are explicit.** No accidental status changes from card clicks. Saves require a button press. The drawer pattern is correct and should stay.

---

## Navigation Architecture

Replace the current four-item sidebar with a semantically cleaner structure:

```
┌─────────────────────┐
│  Schoology Bot      │  Logo + brand
├─────────────────────┤
│  ▣  Tonight         │  ← default, red badge for action items
│  ◫  This Week       │  ← new: calendar planning view
│  ≡  All Schoolwork  │  ← full assignment list
├─────────────────────┤
│  ○  System          │  ← health status (single icon, not full section label)
└─────────────────────┘
   [P]  Parent         ← footer user row
```

**Tonight** replaces "Tonight's Plan" + "Follow-up Tasks" (tasks live in the right column)
**This Week** is new — a calendar strip + day-lane view
**All Schoolwork** stays as-is
**System** replaces "System Health" — quieter, in the Monitor section

**Mobile** (≤ 860px): sidebar collapses entirely. Bottom tab bar appears:
```
[Tonight] [Week] [Work] [System]
```

---

## View Designs

### Tonight (Default View)

The mission control screen. Two columns on desktop, single stack on mobile.

**Left column — assignments:**
```
┌──────────────────────────────────────────────────────────┐
│  Good evening.    Monday, March 15                       │
│  3 items need attention tonight.                         │
├──────────────────────────────────────────────────────────┤
│  ● OVERDUE (1)                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ▐ Math        Chapter 7 Review           2 days ago │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ● DUE TONIGHT (2)                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ▐ English     Essay Outline               Tonight   │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ▐ Science     Lab Write-up                11:59 PM  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ● WAITING ON TEACHER (1) ──────────────────────────── ▾ │
│  ● COMING UP (3) ────────────────────────────────────  ▾ │
│                                                          │
│  ████████████░░░░  4 of 7 resolved tonight               │
└──────────────────────────────────────────────────────────┘
```

- Course left-border stripe color (unique per course, generated from course name hash)
- Due date right-aligned, color-coded: red = overdue, amber = today, gray = future
- Click row → opens review drawer
- Waiting/Coming Up sections are collapsed by default (click header to expand)

**Right column — context panels:**
```
┌──────────────────────────────┐
│  Follow-up Tasks          2  │
│  ─────────────────────────── │
│  ○ Check grade posted        │
│  ○ Ask teacher re: quiz       │
│  + Add follow-up             │
├──────────────────────────────┤
│  This Week                   │
│  Mon ●● Tue ● Wed ○          │
│  Thu ●●● Fri ●               │
├──────────────────────────────┤
│  System        ● All OK      │
│  Last sync: 12 min ago       │
└──────────────────────────────┘
```

- Right column panels are collapsible on mobile (hidden by default, accessible via section toggle)
- "This Week" mini-calendar uses dot density to show assignment load per day
- System panel: green dot = all services OK; amber/red = something needs attention with link to System view

---

### This Week (New View)

A planning view for the upcoming 7 days.

```
┌────────────────────────────────────────────────────────────────┐
│   ← This Week     Mar 15 – Mar 21, 2026                    →  │
├────────┬────────┬────────┬────────┬────────┬────────┬──────────┤
│  SUN   │  MON   │  TUE   │  WED   │  THU   │  FRI   │  SAT    │
│  15    │  16    │  17    │  18    │  19 ●  │  20    │  21     │
│  ●     │  ●●    │        │  ●●●   │        │  ●     │         │
└────────┴────────┴────────┴────────┴────────┴────────┴──────────┘

TODAY  ───────────────────────────────────────────────────────
  English     Essay Outline                            Tonight
  Science     Lab Write-up                             11:59 PM

TOMORROW ──────────────────────────────────────────────────────
  Math        Unit Test                                8:00 AM

WEDNESDAY ─────────────────────────────────────────────────────
  History     DBQ Essay                                11:59 PM
  Spanish     Vocab Quiz                               8:00 AM
  Art         Portfolio Submission                     11:59 PM
```

- Calendar strip at top — click any day to jump to it
- Days with assignments show colored dots (red = overdue/urgent, amber = today, blue = future)
- Assignments grouped by day below the strip
- "This week" can shift forward/back via arrows — not locked to the current calendar week

---

### All Schoolwork (Existing, Refined)

Mostly unchanged. Two refinements:

1. **Course grouping toggle**: add a "By Course" view mode alongside the current status-based grouping. Parent can flip between "show me by urgency" and "show me by subject."
2. **Inline status pill on rows**: the current pill shows status, but add a **left border stripe** with course color (same as Tonight view) to make courses scannable.

---

### System (Replaces Admin)

Demote this from a full sidebar nav item to a **slide-in panel** triggered by:
- Clicking the status dot in the right column of Tonight
- Clicking the "System" sidebar item (which opens the panel, not navigates to a new view)
- Keyboard shortcut `G then H` (go to health)

The panel shows:
- Service status list (green/amber/red dots + last heartbeat time)
- Last scrape age + next scheduled run
- Assignment/task counts
- Quick links to Docker commands

This keeps System Health accessible without giving it the same visual weight as Tonight or All Schoolwork — which it shouldn't have for a parent checking homework.

---

## Design System Tokens (Additions to Current)

### Course Colors (new)
Generate a stable color per course name using a hash → palette mapping.
Six course-safe colors that work on both white and the dark sidebar:

```
--course-1: #6366f1  (indigo)    Math, Algebra
--course-2: #0ea5e9  (sky)       Science, Bio
--course-3: #10b981  (emerald)   English, Writing
--course-4: #f59e0b  (amber)     History, Social Studies
--course-5: #ec4899  (pink)      Art, Music
--course-6: #8b5cf6  (violet)    Spanish, Languages
```

The left-border stripe on assignment rows uses these.

### New Component Patterns
- **`.assign-row` left stripe**: `border-left: 3px solid var(--course-N)` with `padding-left: 12px`
- **`.week-strip`**: horizontal 7-column grid, each cell shows day name, date, dot indicators
- **`.day-lane`**: full-width section with a subtle `hr` header showing day name + date
- **`.system-panel`**: right-anchored slide-in panel (shares `.drawer` base styles but different width/position)
- **`.bottom-tabbar`**: mobile-only fixed bottom bar with 4 icon+label tabs
- **`.status-dot`**: small inline circle with `--color` custom property — used in system panel and tonight right-col

---

## Key Interaction Patterns

### Command Palette (⌘K / Ctrl+K)
A floating search + command launcher. Parent types:
- Assignment name → opens it in drawer
- Course name → filters All Schoolwork to that course
- "add task" / "add reminder" → opens new task/reminder flow
- "refresh" → triggers Schoology sync

This is the power-user escape hatch that makes the dashboard feel like a real product.

### Row Hover Reveals
On desktop, hovering an assignment row reveals:
- Quick status picker (icon buttons: ✓ Submitted, ⏸ Waiting, × Skip)
- These fire the drawer in a specific mode, pre-focused on the action

### Mobile Drawer
On mobile (≤ 600px):
- Drawer becomes 100vw, slides up from the bottom (not in from the right)
- Header stays visible above the drawer
- Close via swipe-down or the × button

### Keyboard Navigation
- `Tab` / `Shift+Tab` through rows
- `Enter` / `Space` to open drawer
- `Escape` to close drawer
- `G H` to open system health panel
- `G W` to switch to week view
- `G T` to switch to tonight view
- `⌘K` to open command palette

---

## Mobile Layout

### Bottom Tab Bar (replaces sidebar on mobile)
```
┌────────────────────────────────────┐
│                                    │
│   (main content area)              │
│                                    │
├──────────┬──────────┬──────┬───────┤
│ Tonight  │ This Week│ Work │  Sys  │
│  ● 3     │          │      │  ●    │
└──────────┴──────────┴──────┴───────┘
```

- Badge on "Tonight" shows action count
- Badge on "Sys" shows amber/red dot if unhealthy

### Assignment Rows on Mobile
- Wider touch target (min 52px height)
- Course stripe still visible as left border
- Status pill right-aligned
- Long titles truncate with ellipsis (one line only)

### Drawer on Mobile
- Full-width, slides up from bottom
- 90vh height, scrollable
- Swipe down to dismiss
- Sticky action buttons at bottom of drawer

---

## Implementation Phases

### Phase 1 — Foundation Fix (Now)
- Fix sidebar nav selections (JS bug or Docker rebuild)
- Add course color stripes to assignment rows
- Add mobile bottom tab bar
- Refine Tonight right-column System panel (status dot + minimal health summary)

### Phase 2 — This Week View
- Week strip calendar component
- Day-lane grouping
- Navigation (prev/next week arrows)
- Sync with existing `/api/home` data (assignments have `dueDateYmd`)

### Phase 3 — System Panel Demotion
- Move System Health from full nav view to a slide-in panel
- Triggered by status dot click in tonight right-col
- Keeps "System" in sidebar as a panel trigger, not a view switch

### Phase 4 — Command Palette
- ⌘K opens modal overlay
- Fuzzy search across assignments (client-side, from loaded state)
- Hard-coded command shortcuts (refresh, add task, go to week)

### Phase 5 — Polish
- Course color hashing
- Micro-animations: row check-off, badge count transitions
- Keyboard navigation (G-codes, arrow keys through rows)
- Drawer slide-up on mobile

---

## What This Is NOT

- Not a grade tracker (grades come from Schoology, we just show status)
- Not a calendar replacement (week view is planning-only, not a full cal)
- Not a multi-student dashboard (single child, single session)
- Not a notification center (that's Telegram)
- Not public-facing (local-first, Tailscale for remote)
