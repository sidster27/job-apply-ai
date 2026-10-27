---
name: job-filters
description: Filter and score job postings for finance analyst / research / internship roles. Use when the user says "filter jobs", "clean jobs", "score jobs", "job filters", or after a job pull. Claude reads each job description; the script is only a fast first pass.
---

# Job Filtering Skill (Finance Analyst / Research / Internship)

Two stages: a fast script pass, then Claude reading the full description of everything that survives. **The title is a hint; the description is the truth.**

## What we are looking for

Single source of truth: `config/search-spec.json`. Read it first; never hardcode targeting here.

- **Roles:** financial analyst, equity research analyst, investment analyst, research analyst, corporate finance, credit / fixed income analyst, asset management, wealth management, private equity / venture / hedge fund analyst, infrastructure and project finance (including data-center / digital infrastructure and energy), supply chain finance. Internships and entry-level analyst roles.
- **Sectors (priority):** buy-side research, asset management, alternatives, energy and infrastructure finance, equity research, wealth management, corporate finance, credit / fixed income, supply chain finance.
- **Level:** internship, analyst, associate (entry), full-time analyst programs for the **Class of 2027**, rotational / development programs.
- **Availability:** graduating May 2027; start after that.
- **Degree level:** the applicant is a **graduate (master's) student**. Remove postings specifically for undergraduate / bachelor's students ("rising junior / senior", "currently pursuing a bachelor's", "undergraduate program") unless they also welcome graduate students. A plain "Bachelor's degree required" is fine. Postings for master's / MBA candidates are a plus.
- **Location:** anywhere in the United States, major financial hubs preferred; in-person is fine; remote-US is fine.
- **Authorization:** no sponsorship needed - do not drop roles for "no sponsorship" language. Roles that require U.S. citizenship are fine too.
- **Salary:** do not filter on it.

## Stage 1 - script (fast)

```bash
node scripts/greenhouse-filter.cjs                  # core titles from the spec
node scripts/greenhouse-filter.cjs --with-suggested # also the spec's suggested titles
node scripts/greenhouse-filter.cjs --min-score 40 --show 50
```

Writes `data/jobs/greenhouse-filtered.json` with kept jobs (score, tier A/B/C, flags) and every removed job with its reason. Always skim the **removed** list's reasons - if good jobs are being cut, fix `search-spec.json`, not the code.

## Stage 2 - Claude reads each surviving job

For each kept job, read the **full** description (never truncated) and decide keep / remove:

**Keep** if the day-to-day work is finance analysis: modeling, valuation, research, portfolio or fund analysis, credit work, FP&A, treasury, project finance, wealth / investment support, etc.

**Remove** if, after reading it, the role is really:
- operations, accounting-only, audit-only, or tax-only with no analytical finance (unless the user asks for those)
- sales, client service, recruiting, marketing, compliance-only, IT / data engineering
- more senior than entry level (asks for 4+ years, "leads a team", "manages analysts")
- outside the U.S. with no U.S. option
- a staffing agency or aggregator repost rather than the employer
- the wrong class year (e.g. Summer 2026 programs, or Class of 2028+)
- undergraduate-only programs (read the whole description; the script only sees the first ~2,000 characters)
- already applied (check `data/applications-log.json`, only `status: "submitted"` counts)

**Flag, don't silently drop:**
- Internships when the user graduates in May 2027: many summer-2027 internships are for students returning to school. Mark `eligibility: "check"` and say why; keep Class-of-2027 full-time and off-cycle programs.
- Roles that ask for credentials the user does not hold (e.g. CFA charterholder): keep, but list under `gaps`.
- Any posting where the description is missing: keep, note "JD not available".

## Scoring (0-100) - draft weights in `scoring` of the spec

Role term in title, entry-level wording, Class of 2027, sector match, hub city, in-person U.S., freshness; penalties for 3 years' experience, internship eligibility question. Tier A >= 70, B >= 50, C >= 30. Claude may adjust a score by up to +/-10 after reading the description, and must say why in `reason`.

## Output per job

```json
{
  "id": "123", "company": "acme-capital", "title": "Equity Research Analyst - Class of 2027",
  "url": "https://...", "decision": "keep", "score": 88, "tier": "A",
  "sectors": ["equity-research", "buy-side-research"],
  "eligibility": "ok",
  "gaps": ["Series 86/87 preferred - not held"],
  "reason": "Fundamental equity research program, 2027 start, Boston.",
  "resumeStrategy": {
    "variant": "equity-research",   // one of: equity-research | asset-mgmt-alternatives | energy-infrastructure | corporate-finance | base
    "leadWith": "most relevant true experience for this role",
    "emphasize": ["phrases from the JD that match real experience"],
    "angleFromJD": "One sentence: what is this team actually hiring for?"
  }
}
```

Removed jobs get `decision: "remove"` and a one-line `reason`. Save everything to `data/jobs/filtered-ready.json` (kept sorted by score, then newest). Print a summary: input, kept per tier, removed per reason, flagged for eligibility.

## Caching

Record every LLM-reviewed job id in `data/jobs/llm-validated-ids.json`; on later runs only review new ids. Re-review a cached job only if the user changes the spec.

## Rules

1. Read the description, not just the title.
2. Never fabricate a description or assume a requirement that is not in the text.
3. Save removed jobs with reasons so the user can override.
4. When unsure, keep and flag - a missed good job costs more than an extra review.
5. Re-run the already-applied check before every batch.
