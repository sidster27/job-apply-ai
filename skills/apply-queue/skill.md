---
name: apply-queue
description: Apply to the next N roles from the live workbook's Main Database, in strict newest-first order, with resume approval, per-role "submit", and Excel tracking. Use when the user says "/apply-queue", "apply-queue 5", "work the queue" or "apply to the next roles".
---

# Apply queue

Discovery is not this skill's job: a scheduled task fills the workbook's **Main Database** daily. This skill
turns that list into submitted applications and keeps `Application_Tracker.xlsx` current. Read
`CLAUDE.md` (fork rules 1-13) first; `docs/pipeline.md` shows the whole loop.

## 0. Start the session

```
scripts/py.sh scripts/tracker.py session-start
scripts/py.sh scripts/build-apply-queue.py --top N        # N from "/apply-queue N", default 10
```

- `session-start` records the workbook's mtime (the write-back guard) and lets the tracker back itself up
  once before its first write.
- The queue reads the live workbook (`$JOB_WORKBOOK`) through a temp copy. Never open the workbook in the
  repo; never edit it here.
- If `config/profile.json` has no graduation date, the script stops: ask him.

## 1. Show the queue as built

Show the top N **in queue order** (rank, company, title, location, date added, deadline, route, resume
variant, blockers) plus the separate "closing within 7 days" list. Do not reorder by fit or deadline. If he
wants a closing role first, he says so.

Add each shown role to the tracker as Queued:

```
scripts/py.sh scripts/tracker.py add --key "<dedupeKey>" --company "<company>" --title "<title>" \
  --location "<location>" --link "<careersLink>" --date-added <dateAdded> --variant <resumeVariant> --status Queued
```

## 2. Re-check every posting (Playwright MCP)

For each role, open the Careers Link and find the actual posting (a program page is not a posting: find the
requisition). Confirm:

- it is still live (otherwise `update --status Closed --blocker "posting removed"`);
- he is eligible: graduation **May 2027** (from profile.json), years of experience asked, GPA minimum,
  class year, location. If not, `--status Skipped --blocker "<why>"`;
- the real ATS behind Apply (`node scripts/detect-ats.cjs "<apply url>"`). Account-based systems (Workday,
  iCIMS, Oracle, Tal.net, Taleo) need him to create the account and sign in.

Use the Greenhouse boards API (`boards-api.greenhouse.io/v1/boards/<slug>/jobs/<id>`) for Greenhouse
postings; never fetch LinkedIn, Handshake, Indeed, Glassdoor or ZipRecruiter.

## 3. Draft, then wait for batch approval

- Resume: `skills/tailor-resume/skill.md` with the queue's variant as the starting point. Build from
  `data/resume-bank/bank.json` only; `node scripts/resume-bank.cjs facts <resume.txt>` must pass.
- Cover letter only if the form asks for one or it clearly helps: `skills/cover-letter/skill.md`, same bank,
  and run the same facts check on its text. Record `--cover-letter Y|N`.
- `tracker.py update --key K --status Drafted`.
- Send him every resume (and cover letter) with the changes and gaps. **Wait for his batch approval.**
  Then `--status Approved`. Nothing is uploaded before this.

## 4. Apply, one role at a time

Fill with Playwright MCP from `config/profile.json` and `config/standard-answers.json`. **Stop and ask** for:

- logins, account creation, verification codes, CAPTCHAs (he does them; never ask for a password);
- work-authorization or sponsorship questions whose wording differs from profile.json;
- demographic / EEO questions not covered by his recorded choice (decline all);
- salary when a number is required, conflict-of-interest, legal, background-check or any answer not in
  profile.json.

Screenshot the filled form (`data/resumes/<slug>-<id>/form-before-submit.png`) and show him. **Never click the
final Submit until he types "submit" for that role.** Then screenshot the confirmation and immediately:

```
scripts/py.sh scripts/tracker.py update --key K --status Applied --date-applied <today> \
  --confirmation "<what the confirmation page said / portal link>" --notes "<answers that needed him>"
```

(or `--status Blocked --blocker "<why>"`). Follow-up Date is set to Date Applied + 7 days.

## 5. End of session: guarded write-back

```
scripts/py.sh scripts/writeback.py --dry-run
scripts/py.sh scripts/writeback.py
```

It sets only Status ("Applied" / "Skip") and Date Applied in Main Database, matched by Dedupe Key, after
backing the workbook up. It refuses if the workbook is open in Excel (`~$` lock file) or changed during the
session. If it refuses, write nothing and tell him; the tracker alone is enough.

Finish with `scripts/py.sh scripts/tracker.py list` and a short summary: applied, skipped, blocked, what
needs his hands.
