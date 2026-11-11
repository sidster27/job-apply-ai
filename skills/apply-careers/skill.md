---
name: apply-careers
description: Apply to a posting found on a firm's careers page, Workday, Handshake, LinkedIn or any other source - detects the real ATS, unwraps redirects, routes by ATS, and enforces per-role approval. Use when the user gives a job link that is not a plain Greenhouse board, says "apply on Workday", "this is from Handshake", or the Apply button redirects.
---

# Apply via careers pages, Workday, Handshake and other sources

Read `docs/job-sources.md` once. Registry: `config/job-sources.json`, `config/careers-sources.json`.

## Hard rules

1. **Nothing is submitted** without his batch approval of the list **and** a per-role "submit" after he has seen the final screenshot.
2. **Never ask for, read or type a password.** He signs in, creates accounts, enters verification codes and solves CAPTCHAs himself. If a step needs it, stop and say what he has to do, then wait.
3. **Handshake, LinkedIn, Indeed, Glassdoor, ZipRecruiter are user-driven.** Do not navigate, search, crawl or fetch them. Work only on a page he has open or text he pastes.
4. Only facts from his resume bank (or that he states) go into answers. Legal, criminal, sanctions, insider-trading, waiver or conflict-of-interest questions: stop and ask him.
5. Track every application in `Pilot_Tracker.xlsx`. Ignore `next-job.cjs` / `progress-update.cjs`; they do not exist in this fork.

## Steps

1. **Detect.** `node scripts/detect-ats.cjs "<url>" --json`. It unwraps wrapper links and returns `ats`, `route`, `account`.
2. **Redirect check.** If the result is a careers home/search page, not a specific posting, find the posting by title and location on that page (or ask him to open it), then detect again. If the Apply button leads to another host, detect that URL. Unknown host: tell him and offer `node scripts/add-source.cjs`.
3. **Resume first.** Follow `skills/tailor-resume/skill.md` (title -> variant -> tailored copy -> `resume-bank.cjs facts` passes). Show him the variant and gaps.
4. **Route:**
   - `greenhouse` -> follow `skills/apply-jobs/skill.md` (Playwright MCP, one job at a time).
   - `workday` -> follow `docs/workday-ats-guide.md`. Needs an account for **that tenant**: ask him to create it and sign in in the Playwright browser window; wait for "done". Then fill each step; Workday often re-parses the resume, so check every field after upload.
   - other ATS (Lever, Ashby, iCIMS, SmartRecruiters, Taleo, Oracle) -> same pattern as Workday: he handles login/verification, Claude fills and screenshots.
   - `user-driven` -> he applies in his own browser. Offer: the tailored resume file, drafted answers to paste (from `config/standard-answers.json` + his facts), a checklist of fields. When he says he submitted, log it.
5. **Before submit:** screenshot the final review page and show him. Ask: "Submit this one? (submit / skip / change)". Only an explicit "submit" for **this** role counts.
6. **After submit:** screenshot the confirmation, then update `Pilot_Tracker.xlsx` (company, title, URL, date, source, variant, status, notes, follow-up date).
7. **Stop conditions:** CAPTCHA, SSO, email code, "account already exists" loop, unfamiliar form, or any request for legal/financial-crime answers. Say what is blocking and wait; never improvise around it.

## Pilot limits

Applications only (no LinkedIn connections or cold emails yet). 5-10 roles, one at a time, dry run first.
