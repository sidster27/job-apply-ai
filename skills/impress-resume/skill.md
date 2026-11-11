---
name: impress-resume
description: Deeper, researched tailoring for priority (Tier A) finance roles - researches the firm, team and sector, then reframes his true experience around what the team is hiring for. Use when the user says "impress resume", "deep tailor", or "custom resume for [company]". Truthful only; built from the resume bank.
---

# Impress Resume (Finance) - deep tailoring, true facts only

Use for Tier A jobs. Everything in `tailor-resume` applies, including its source of truth (`data/resume-bank/bank.json`), its allowed edits, the mandatory `resume-bank.cjs facts` check, and the "do not" list. This skill adds research and an interview-prep pack.

## 1. Understand the job

Write down: what the person will do day to day (models, coverage, reports, who they support); what the team stresses (listed first, repeated); seniority and timing (internship vs analyst, Class of 2027); tools and credentials asked for, and which he truly has.

## 2. Research the firm and team (official sources first)

- Firm: strategy, size/AUM, products, recent news, how the group is organised (official site, annual report, regulatory filings such as Form ADV or 10-K, then reputable press).
- Desk/sector: themes covered and the vocabulary practitioners use.
- Team leads' public work, if available.

Research informs **emphasis and vocabulary only**. Never import claims about him from research. List sources in `notes.md`.

## 3. Map his true experience to the job

Make a table: *requirement -> closest true bullet (bank id) -> note*. No true match = **gap**. Use `node scripts/resume-bank.cjs find <tag>` to search the bank by theme.

## 4. Choose and build the version

Pick the nearest of the six variants (see `tailor-resume`; for an unfamiliar title follow its Step 3, including confirming the choice with him and saving the title with `learn-title.cjs`). Then:

- Lead each employer with the bullets that best match the requirement table; drop the least relevant.
- Reword vocabulary toward the posting only when it describes the same work; keep every number and outcome as in the bank.
- Reorder the skills line to what the posting asks for and he actually has.
- Keep the Amod template layout, one page.

## 5. Check

Run `node scripts/resume-bank.cjs facts <final.txt>` and fix every FAIL. Confirm dates, titles, employers, degrees unchanged; contact links correct; PDF is one page.

## 6. Output

`data/resumes/{company-slug}-{jobId}/Siddharth_Bhatia_Resume.docx` and `notes.md` with: job summary, research sources, requirement -> evidence table, changes, **gaps**, **questions for him**, and **interview talking points** - the true story behind each emphasised bullet, in his words as far as the bank supports them.

## Rules

1. True facts only; ask when unsure.
2. Research informs emphasis, never content about him.
3. Report gaps; never hide them.
4. Originals are never overwritten.
5. One folder per job.
