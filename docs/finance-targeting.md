# Finance targeting (this fork)

This fork is tuned for **finance analyst / research / internship** roles. Everything about *what to look for* lives in one file:

**`config/search-spec.json`**

| Section | What it controls |
|---|---|
| `candidate` | Class year (2027), availability, internship-timing note |
| `titles` | Strong role terms, entry-level words, optional `suggested` titles (`useSuggested`) |
| `financeContext` | When a generic title ("Analyst", "Associate") counts as finance |
| `sectors` | Priority sectors and the words that signal them |
| `exclude` | Too-senior words, non-finance domains, non-U.S. places, years-of-experience limits |
| `locations` | U.S. scope, remote allowed, financial-hub cities (score bonus) |
| `scoring` | Draft weights, tier cut-offs (A >= 70, B >= 50, C >= 30), minimum score |
| `resumeVariants` | Four resume variants (equity research, asset management & alternatives, energy & infrastructure, corporate finance) and how each job is matched to one |
| `applyPolicy` | Dry-run by default; questions that always go to the user |

Change the file, run `npm test`, then `npm run pipeline` (or `node scripts/greenhouse-filter.cjs --with-suggested`). No code change needed to retarget.

## How the pieces fit

```
pull (Greenhouse boards / LinkedIn / career pages)
  -> filter script (config/search-spec.json: fast heuristics + score + tier)
  -> job-filters skill (Claude reads each surviving description)
  -> tailor-resume / impress-resume (true facts only; gaps reported)
  -> apply-jobs (fills forms, STOPS for your approval before every submit)
  -> log (data/applications-log.json)
```

## Principles

1. **Strongest honest resumes.** Tailoring leads with the best true work, in strong specific language, using the numbers you provide. It never inflates metrics, scope, titles, tools or credentials; unmet requirements are listed as gaps and Claude asks you for real detail instead.
2. **Graduate student.** Undergraduate-only postings are excluded; master's / MBA programs get a score bonus.
3. **You approve every submission.** No auto-submit. Legal, criminal, regulatory, waiver and health questions are never auto-answered (`ASK_USER`).
4. **Personal data stays local.** `config/profile.json`, your real resume text (`templates/resume-base.txt`), `.docx` / `.pdf` files and everything under `data/` are git-ignored. This fork is public: never commit them.

## Setup on your machine

```bash
git clone https://github.com/sidster27/job-apply-ai.git && cd job-apply-ai
npm install && npx playwright install chromium
cp config/profile.example.json config/profile.json            # fill in (local only)
cp templates/resume-base.example.txt templates/resume-base.txt # paste your real resume text (local only)
npm test
```

## Known limits

- Greenhouse boards skew toward tech companies; many asset managers and banks use Workday, iCIMS or their own sites. Use your Target Company List for those (career-page discovery; Workday support in the ATS handlers is beta).
- `config/greenhouse-companies.json` holds 4,000+ board slugs (the original README says 929). Slugs are not finance-specific; replace with finance firms as the company list grows.
- The cloud workspace used for drafting cannot reach Greenhouse / Lever APIs (proxy blocks them), so pulls run on your machine or via search / fetch.
- Summer internships: with a May 2027 graduation, many summer-2027 programs target students who return to school. They are flagged for an eligibility check, not dropped.
