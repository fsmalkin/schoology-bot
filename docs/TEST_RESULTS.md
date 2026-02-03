
> schoology-missing-assignments@0.1.0 test
> node --test

TAP version 13
# Subtest: updateAssignmentStatus maps letter codes
ok 1 - updateAssignmentStatus maps letter codes
  ---
  duration_ms: 8.9457
  ...
# Subtest: applyNumberedStatuses updates by list index
ok 2 - applyNumberedStatuses updates by list index
  ---
  duration_ms: 2.5945
  ...
# Subtest: listAssignments hides ignored by default
ok 3 - listAssignments hides ignored by default
  ---
  duration_ms: 1.0679
  ...
# Subtest: extractMissingAssignmentsFromHtml finds missing and excludes exempt
ok 4 - extractMissingAssignmentsFromHtml finds missing and excludes exempt
  ---
  duration_ms: 264.756
  ...
# Subtest: normalizeManualStatus maps codes
ok 5 - normalizeManualStatus maps codes
  ---
  duration_ms: 1.1442
  ...
# Subtest: normalizeManualStatus returns custom text
ok 6 - normalizeManualStatus returns custom text
  ---
  duration_ms: 0.2094
  ...
# Subtest: sanitizeRepeatedText collapses repeated lines
ok 7 - sanitizeRepeatedText collapses repeated lines
  ---
  duration_ms: 1.0273
  ...
# Subtest: sanitizeRepeatedText collapses repeated phrases
ok 8 - sanitizeRepeatedText collapses repeated phrases
  ---
  duration_ms: 0.1987
  ...
# Subtest: isRepetitiveOutput detects repeated lines
ok 9 - isRepetitiveOutput detects repeated lines
  ---
  duration_ms: 0.3035
  ...
# Subtest: isRepetitiveOutput allows normal text
ok 10 - isRepetitiveOutput allows normal text
  ---
  duration_ms: 0.1362
  ...
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 921.667

Test run at: 2026-02-03 01:38:18


## Agentic Conversation Test

**User:** What assignments are missing?

**Agent:** You’re missing these assignments:

- **Algebra** — *Homework 1* (Due **2026-01-01**) — **Missing**
- **Science** — *Lab 1* (Due **2026-01-02**) — **Missing**

**User:** Mark Homework 1 as B

**Agent:** Set **Algebra — Homework 1** to **B (Practice / not for grade)**.

You still have 1 missing assignment:
- **Science — Lab 1** (Due 2026-01-02) — Missing

**User:** What is missing now?

**Agent:** Only **Science — Lab 1** (due **2026-01-02**) is missing now.

Agentic conversation test completed.

Agentic conversation test failed: EBUSY: resource busy or locked, unlink 'C:\Users\afutu\schoology\data\agent_test.db'

Agentic test run at: 2026-02-03 01:40:53


## Agentic Conversation Test

**User:** What assignments are missing?

**Agent:** These assignments are currently **missing**:

- **Algebra** — *Homework 1* (Due **2026-01-01**) — Score: **0/10**
- **Science** — *Lab 1* (Due **2026-01-02**) — Score: **0/10**

**User:** Mark Homework 1 as B

**Agent:** Updated **Algebra — Homework 1** to **B (Practice / not for grade)**, so it won’t count as missing anymore.

You still have **1 missing** assignment:
- **Science — Lab 1** (Due **2026-01-02**)

**User:** What is missing now?

**Agent:** Right now, the only **missing** assignment is:

- **Science** — *Lab 1* (Due **2026-01-02**) — Score: **0/10**

(*Algebra — Homework 1* is now marked **B / Practice**, so it’s ignored.)

Agentic conversation test completed.

Agentic conversation cleanup warning: failed to delete C:\Users\afutu\schoology\data\agent_test.db

Agentic test run at: 2026-02-03 01:41:56


## Agentic Conversation Test

**User:** What assignments are missing?

**Agent:** Missing assignments (2):

- **Algebra** — *Homework 1* (Due **2026-01-01**) — **Missing** — Score: 0/10  
- **Science** — *Lab 1* (Due **2026-01-02**) — **Missing** — Score: 0/10

**User:** Mark Homework 1 as B

**Agent:** Set **Algebra — Homework 1** to **B (Practice / not for grade)**.

**User:** What is missing now?

**Agent:** Missing now (1):

- **Science** — *Lab 1* (Due **2026-01-02**) — **Missing** — Score: 0/10

Agentic conversation test completed.

Agentic test run at: 2026-02-03 01:43:09

