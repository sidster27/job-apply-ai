# Job sources: where postings come from and how each one is applied to

Postings reach you from several places. Each place has a **route** that says who drives the browser.

| Source | Examples | Route | Who does what |
|---|---|---|---|
| Greenhouse boards | boards.greenhouse.io/<slug>, job-boards.greenhouse.io | `auto-fill-with-approval` | Pull + filter run as scripts; Claude fills the form with Playwright MCP, screenshots it, you say "submit" per role |
| Firm careers pages | citadel.com/careers, blackrock.com/careers | `read-then-decide` | Claude reads the posting, runs `detect-ats` on the Apply link, then uses the route of the ATS it leads to |
| Workday | <tenant>.wd1.myworkdayjobs.com | `auto-fill-with-approval` | One account **per tenant**. You create it, sign in, and clear email verification/CAPTCHA; Claude fills each step and screenshots before submit |
| Other ATS | Lever, Ashby, iCIMS, SmartRecruiters, Taleo, SuccessFactors, Oracle | `auto-fill-with-approval` | Same as Workday; unfamiliar multi-step flows fall back to you driving |
| Handshake | Rochester Handshake postings | `user-driven` | You browse in your own logged-in browser. Claude only reads the page you have open, tailors the resume, and drafts answers for you to paste |
| LinkedIn, Indeed, Glassdoor, ZipRecruiter | | `user-driven` | Same as Handshake. Their terms prohibit automated collection, so Claude never crawls, searches or fetches them |

## Redirects ("Apply" bounces you back to the careers site)

Aggregator Apply buttons usually hand off to the employer. Never treat the aggregator as the destination:

1. Run `node scripts/detect-ats.cjs "<url>"`. It **unwraps** wrapper links (query parameters such as `url=`, `redirect=`, `externalApplyUrl=`, including two layers deep, e.g. LinkedIn `safety/go?url=<workday link>`).
2. If the real target is Greenhouse, Workday or another ATS, use that route.
3. If the link lands on a firm's careers **home or search page**, it is not an application. Find the specific posting there (by title and location), then run `detect-ats` on that posting's Apply link.
4. `?gh_jid=` on a firm's own domain means a Greenhouse form embedded in the firm page: treat it as Greenhouse.
5. `--follow` follows plain HTTP redirects (up to 8), but never on Handshake, LinkedIn, Indeed, Glassdoor or ZipRecruiter (`neverFetchHosts`).

## Adding sources later

```
node scripts/add-source.cjs company "Firm Name" --url https://firm.com/careers --metro "New York" --note "analyst program"
node scripts/add-source.cjs source --id wellfound --label "Wellfound" --host wellfound.com --route user-driven --note "startup roles"
node scripts/add-source.cjs list
```

- `company` adds a firm to `config/careers-sources.json` (ATS is auto-detected from the URL).
- `source` adds a new type of site to `config/job-sources.json` under `custom`. Choose `--route user-driven` unless you know the site allows automation and has an ordinary application form.
- After adding, run `npm test` (the sources test checks the registry stays consistent).

## What is in the registry now

`config/careers-sources.json` holds ~43 target firms with careers URL, detected ATS, and notes from the careers-page scans. The full 735-firm list lives in your project (`Firm_Database_Master.csv`); to load it, put the CSV in the repo folder and run `python3 scripts/export-firm-db.py`.

## Rules that never change

- Nothing is submitted without a batch approval and your per-role "submit".
- You handle every login, CAPTCHA and verification email. Claude never asks for or types a password.
- Handshake/LinkedIn remain user-driven; Claude does not scrape them.
- Every application is logged in `Pilot_Tracker.xlsx`.
