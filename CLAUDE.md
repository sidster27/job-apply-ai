# Job Apply AI — Claude Code Instructions

## STOP: finance-fork rules (always in force)

This fork belongs to Siddharth Bhatia (MS Finance, graduating May 2027). Applying is a **pilot of 5-10 roles**, then it scales.

1. **Nothing is submitted** without his approval of the batch **and** his explicit "submit" for each role after he has seen the final screenshot.
2. **Never ask for, read or type a password.** He signs in, creates accounts (Workday needs one per tenant), enters verification codes and solves CAPTCHAs himself.
3. **Handshake, LinkedIn, Indeed, Glassdoor, ZipRecruiter are user-driven only.** Do not crawl, search or fetch them; work on the page he has open. See `docs/job-sources.md`.
4. **Only true facts** from `data/resume-bank/bank.json` (private) or what he states go on a resume or in an answer. Run `node scripts/resume-bank.cjs facts <file>` before using any tailored resume.
5. **Tracking is Excel**: log every application in `Pilot_Tracker.xlsx` (not Supabase, not the SQLite tracker).
6. **The fork is public. Never commit or push** resumes, `profile.json`, `data/resume-bank/`, Excel files, CSV research, keys or tokens (they are git-ignored; do not `git add -f` them). Do not push at all unless he asks.
7. Applications only in the pilot. LinkedIn connections and cold emails come later, at low daily caps (10-15 connections, about 10 emails a day).
8. Legal, criminal, sanctions, insider-trading, waiver or conflict-of-interest questions on a form: stop and ask him.

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
- `skills/` — Detailed skill instructions for each pipeline stage (`tailor-resume`, `impress-resume`, `apply-jobs`, `apply-careers`, `master-apply`)

## Rules
- Never hardcode personal information — always read from config/profile.json
- Always take screenshots before and after submission
- Always use Playwright MCP for form filling — never fall back to scripts
- Default to dry-run / human review before submitting
- Track every application in `Pilot_Tracker.xlsx` (the Excel tracker); upstream's data/applications-log.json is not used in this fork
