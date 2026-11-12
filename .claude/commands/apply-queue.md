---
description: Apply to the next N roles from the Main Database (default 10), newest first, with approval gates
argument-hint: "[N]"
---

Run the apply-queue workflow in `skills/apply-queue/skill.md` for the top N roles, where N is "$ARGUMENTS" (use 10 if it is empty).

Follow every rule in `CLAUDE.md` (finance-fork rules 1-13): strict newest-first order, resume approval before
any upload, no final Submit until the user types "submit" for that role, never ask for passwords, track each
role in `Application_Tracker.xlsx` right after it, and run the guarded write-back at the end.
