# Job Apply AI — Claude Code Instructions

## STOP: finance-fork rules (always in force)

This fork belongs to Siddharth Bhatia (MS Finance, graduating May 2027). Applying is a **pilot of 5-10 roles**, then it scales.

1. **Nothing is submitted** without his approval of the batch **and** his explicit "submit" for each role after he has seen the final screenshot.
2. **Never ask for, read or type a password.** He signs in, creates accounts (Workday needs one per tenant), enters verification codes and solves CAPTCHAs himself.
3. **Handshake, LinkedIn, Indeed, Glassdoor, ZipRecruiter are user-driven only.** Do not crawl, search or fetch them; work on the page he has open. See `docs/job-sources.md`.
4. **Only true facts** from `data/resume-bank/bank.json` (private) or what he states go on a resume or in an answer. Run `node scripts/resume-bank.cjs facts <file>` before using any tailored resume.
5. **Tracking is Excel**: log every application in the **"Application Tracker" sheet of `Target_Company_List.xlsx`** (repo root, git-ignored) with `scripts/tracker.py`, immediately after each role (not Supabase, not the SQLite tracker). The tracker sheet is the source of truth for what he applied to. `Pilot_Tracker.xlsx` and the old standalone `Application_Tracker.xlsx` are retired archives: do not write to them.
6. **The fork is public. Never commit or push** resumes, `profile.json`, `data/resume-bank/`, Excel files, CSV research, keys or tokens (they are git-ignored; do not `git add -f` them). Do not push at all unless he asks.
7. Applications only in the pilot. LinkedIn connections and cold emails come later, at low daily caps (10-15 connections, about 10 emails a day).
8. Legal, criminal, sanctions, insider-trading, waiver or conflict-of-interest questions on a form: stop and ask him.
9. **Show the tailored resume and get his approval before uploading it**, every time. Send him the file (and the changes/gaps from `notes.md`), wait for an explicit OK, and only then attach it to the form.
10. **Jobs come from two pipelines, used together:** the **Main Database** sheet of `Target_Company_List.xlsx` (filled by his scheduled discovery task) **and** Greenhouse boards (`greenhouse-pull` + `greenhouse-filter`). A careers-page posting is applied to through whatever ATS its Apply button leads to (`detect-ats`, see `docs/job-sources.md`). Do not rebuild the discovery side.
11. **The workbook** is `Target_Company_List.xlsx` in the repo root (override with `$JOB_WORKBOOK`; git-ignored like every `.xlsx`). He designated it as the main application, company and job tracker (2026-11-12). Sheets used: **"Target List"**, **"Careers Sources"**, **"Main Database"** (the jobs to apply to) and **"Application Tracker"** (what was applied to). Ignore "Job Database" and "Jobs". Edit it only through `scripts/tracker.py` and `scripts/writeback.py`: they change just their own XML parts, so every other sheet, dropdown and format stays byte-identical (never re-save it with openpyxl). If Excel has it open (`~$Target_Company_List.xlsx`), tracker changes are queued in `data/tracker-pending.jsonl` and applied by `tracker.py flush`; write-back is skipped. His daily scanner may still write a different copy (`~/Documents/Job:Internship Search/Target_Company_List.xlsx`): that copy is NOT read here, so new Main Database rows only appear in the repo workbook when he copies or merges them in.
12. **Queue order is strict:** `scripts/build-apply-queue.py` orders by Date Added, newest first, ties by sheet row descending. Never reorder by fit or deadline; the "closing within 7 days" list is for his decision only.
13. His graduation date comes from `config/profile.json` (May 2027). If it is missing or looks inconsistent with the workbook, ask him; do not assume.

## Playwright MCP Required (for applying)

Applying needs the Playwright MCP server. Check with `claude mcp list`. If `playwright` is missing, tell him to run this in Terminal (not inside Claude), then restart Claude Code:

```
claude mcp add playwright -- npx -y @playwright/mcp@latest
```

(Claude Code stores MCP servers in `~/.claude.json`, added by that command, not by hand-editing `~/.claude/settings.json`.)

Do NOT fall back to running scripts for applying. The scripts use hardcoded selectors and miss fields. Playwright MCP lets you see and fill forms visually: it works on any ATS, handles custom dropdowns, radio buttons and multi-step flows.

Scripts (`scripts/greenhouse-pull.cjs`, `scripts/greenhouse-filter.cjs`, `scripts/detect-ats.cjs`) are fine for pulling, filtering and classifying links. Only the apply step needs Playwright MCP.

## Quick Start
1. Verify Playwright MCP is configured (see above)
2. Read `config/profile.example.json` to understand the profile schema
3. User must create `config/profile.json` with their own data before running
4. Use `docs/quickstart.md` for setup guide

## Applying to Jobs (Playwright MCP)
1. User provides a job URL or says "apply to jobs"
2. Use `browser_navigate` to open the job application page
3. Use `browser_snapshot` to see the form
4. Read `config/profile.json` for the applicant's data
5. Use `browser_fill_form`, `browser_click`, `browser_select_option` to fill every field
6. Use `browser_take_screenshot` before submitting — show the user
7. Only submit after user confirms

## Apply queue (`/apply-queue N`, default 10)
Full loop and diagram: `docs/pipeline.md`. Step-by-step: `skills/apply-queue/skill.md`.
1. `scripts/py.sh scripts/tracker.py session-start`, then `scripts/py.sh scripts/build-apply-queue.py --top N`. Show the top N in queue order.
2. Re-open each posting (Playwright MCP): still live? eligible (May 2027 graduation, years asked, GPA)? Otherwise mark it Skipped / Blocked / Closed in the tracker with the reason.
3. Draft the resume variant (tailor-resume) and, if useful, a cover letter, from the resume bank only; `node scripts/resume-bank.cjs facts` must pass. Tracker status Drafted. **Wait for his batch approval** (Approved), and show each resume before uploading it.
4. Apply one role at a time. Stop for logins, CAPTCHAs, work-authorization / sponsorship questions, demographic questions and any answer not in `profile.json`. Never click the final Submit until he types "submit" for that role. Update the tracker right after each role.
5. End of session: `scripts/py.sh scripts/writeback.py --dry-run`, then without `--dry-run`. If a guard blocks it, write nothing and tell him; the tracker alone is enough.

Python scripts need openpyxl: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` once; `scripts/py.sh` picks the interpreter.

## Key Files
- `config/profile.json` — Applicant profile (name, email, work history, skills, etc.)
- `config/standard-answers.json` — Common ATS question answers
- `config/greenhouse-companies.json` — finance-firm Greenhouse board slugs (verify with `node scripts/verify-slugs.cjs --apply` on his machine)
- `src/ats/` — ATS form handlers (reference for field patterns)
- `src/tailor/resume-tailor.ts` — Keyword extraction + match scoring
- `config/search-spec.json` — roles, sectors, exclusions and the six resume variants (single source of truth for targeting)
- `config/job-sources.json`, `config/careers-sources.json` — where postings come from and how each is applied to (`docs/job-sources.md`); `scripts/detect-ats.cjs`, `scripts/add-source.cjs`
- `config/role-title-map.json` — job titles he has confirmed map to a resume variant (`scripts/learn-title.cjs`)
- `data/resume-bank/bank.json` — every true resume bullet (private); `scripts/resume-bank.cjs`
- `scripts/build-apply-queue.py`, `scripts/tracker.py`, `scripts/writeback.py` (with `scripts/apply_common.py`, `scripts/queue-bridge.cjs`) — the apply side: queue, tracker, guarded write-back
- `skills/` — Detailed skill instructions for each pipeline stage (`apply-queue`, `tailor-resume`, `impress-resume`, `apply-jobs`, `apply-careers`, `master-apply`)

## Rules
- Never hardcode personal information — always read from config/profile.json
- Always take screenshots before and after submission
- Always use Playwright MCP for form filling — never fall back to scripts
- Default to dry-run / human review before submitting
- Track every application in the workbook's "Application Tracker" sheet via `scripts/tracker.py`; upstream's data/applications-log.json is not used in this fork
