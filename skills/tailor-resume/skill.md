---
name: tailor-resume
description: Tailor Siddharth's resume to a specific finance job using only true facts. Picks one of six role-specific resumes, and for an unfamiliar job title researches the role and builds the closest version from the resume bank. Use when the user says "tailor resume", "resume for [company]", "optimize resume", or "make resume match".
---

# Resume Tailoring (Finance) - truthful by construction

Tailoring means **choosing, ordering and wording true facts for this job**. It never means adding facts.

## Source of truth (in this order)

1. `data/resume-bank/bank.json` - every true bullet from his six final resumes, tagged by theme (private, git-ignored). Use `node scripts/resume-bank.cjs list | render <variant> | find <theme>`.
2. His six Word resumes in `resumes/` (`IB-PE.docx`, `Equity-Research.docx`, `Trading-Investments.docx`, `Asset-Management-Portfolio-Analytics.docx`, `Project-Finance-Energy-Infrastructure.docx`, `Alternatives-Manager-Due-Diligence.docx`). Work on a **copy**; never overwrite them. They follow the Amod template layout.
3. `config/profile.json` (local) for contact details, and anything he tells you in the conversation.

If a fact is not in those places, it does not go on the resume. When he gives a new true fact, add it to the bank first (with tags), then use it.

## The six variants (`config/search-spec.json` -> `resumeVariants`)

| id | Fits titles such as |
|---|---|
| `ib-pe` | Investment Banking, M&A, Private Equity, Venture, Growth Equity, Corporate Development |
| `equity-research` | Equity Research, Buy-side Research, Investment Analyst, Sector Analyst |
| `trading-investments` | Sales & Trading, Markets, Macro, Rates, Quant/Systematic, Investment Analyst on a trading or investments desk |
| `asset-mgmt-portfolio-analytics` | Asset Management, Portfolio Analytics, Performance/Risk, Wealth, Investment Strategy |
| `project-finance-energy-infra` | Project Finance, Energy, Infrastructure, Real Assets, Structured/Credit |
| `alternatives-manager-dd` | Alternatives, Hedge Fund / Fund-of-Funds, Manager Due Diligence, Investment Due Diligence, Manager Research |
| `base` | No clear match (see "Unfamiliar titles") |

A variant is an **emphasis choice**: employers, titles, dates, education and every number are identical. Only which true bullets lead, their wording, and the skills line change.

## Step 1 - Read the job and get the filter's suggestion

The filter (`node scripts/greenhouse-filter.cjs`) outputs `resumeVariant` and `variantRanking` for every kept job; `config/role-title-map.json` holds titles he has already confirmed. Read the full posting: real day-to-day work, what is listed first or repeated, seniority, class year, tools, credentials. Titles lie; the work decides.

## Step 2 - Known title (variant is not `base`, no tie flag)

Start from the variant text (`node scripts/resume-bank.cjs render <variant> --out /tmp/draft.txt`), then go to Step 4.

## Step 3 - Unfamiliar title (variant is `base`, or the filter says "tie" / "no variant matches")

His resumes cover six role families, but job titles vary a lot ("Investment Strategy Analyst", "Credit Risk Associate", "Fund Operations Analyst", "Treasury Analyst"). Do not guess from the title alone:

1. **Research the role** (official sources first: the posting itself, the firm's careers and about pages, regulatory filings; then credible industry sources). Capture what the person actually does, the vocabulary practitioners use, the tools named, and the credentials expected.
2. **Write a short role brief** in `notes.md`: 5-8 lines - what the work is, which of his six families it is closest to and why, which tags from the bank it needs (e.g. `due-diligence`, `risk-metrics`, `valuation`, `macro`, `excel-modeling`, `credit`).
3. **Choose the nearest variant** and **tell him which one and why** before building. If two fit, say so and ask. He confirms.
4. **Build from the bank, not from imagination:** `node scripts/resume-bank.cjs find <tag> <tag>` lists the true bullets that carry those tags. Start from the nearest variant, then swap in or reorder bullets from other employers' variants where the tags fit the role better. A role may also need fewer bullets; do not pad.
5. After he approves the resume, **save the title** so the filter picks it next time:
   `node scripts/learn-title.cjs "<exact job title>" <variant-id>`

## Step 4 - Tailor the draft (allowed edits only)

- **Reorder** bullets within a role so the most relevant true work leads. Reorder or drop bullets that distract.
- **Swap** a bullet for another true bullet from the bank (same employer only; a bullet never moves to a different employer).
- **Reword vocabulary** to match the posting when it honestly describes the same work (e.g. "manager due diligence" vs "manager research"). Keep every number, scale, tool and outcome exactly as in the bank.
- **Skills line:** reorder; add a skill only if it is in the bank's allowed skills or he explicitly confirms he has it. A requirement he cannot back (CFA, a language, Python library, Argus, Capital IQ, VBA, SQL, etc.) is reported as a **gap**, never written onto the page.
- Employers, titles, dates, degree, expected graduation (May 2027) and contact details are never altered.
- One page. Same layout, fonts and section names as the Amod template: Education, Professional Experience, Experiential Learning, Additional Information. No tables, text boxes or images for content.

## Step 5 - Check (mandatory, run it)

Save the final plain text and run:

```
node scripts/resume-bank.cjs facts /path/to/final.txt
```

It fails on any number, tool or bullet that cannot be traced to the bank. Resolve every FAIL (remove it, or ask him for the real fact and add it to the bank). Also check: fits one page after rendering to PDF, company and role spelled as in the posting where the resume mentions them, nothing duplicated from another bullet.

## Step 6 - Report

Tell him: variant used (and the title-research summary if it was unfamiliar), what was reordered/swapped/reworded, the **gaps list** (requirements he cannot honestly claim), and any question you need answered. Offer the title save if it was a new title.

## Do not

- Invent numbers, tools, titles, certifications, coursework, AUM figures or outcomes; stretch a claim; keyword-stuff; claim credentials not held (state CFA/exam status exactly as he gives it).
- Mention that a role was "AI-generated" or reveal tooling in the resume.
- Overwrite originals.

## Approval gate

The tailored resume is **not** usable until he has seen it and said OK. After Step 6, send him the `.docx` (and the report), then wait. Only an approved resume may be uploaded to a form.

## Output

`data/resumes/{company-slug}-{jobId}/Siddharth_Bhatia_Resume.docx` (edit a copy of the chosen variant `.docx` with python-docx, preserving styles) and `notes.md` containing: variant, role brief (if researched), changes, gaps, questions. Convert to PDF to check the page count; attach the PDF unless the form asks for Word.
