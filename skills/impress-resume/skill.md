---
name: impress-resume
description: Deeper, researched version of resume tailoring for priority (Tier A) finance roles - researches the firm, team and sector, then reframes true experience around what the team is hiring for. Use when the user says "impress resume", "deep tailor", or "custom resume for [company]". Truthful only.
---

# Impress Resume (Finance) - deep tailoring, true facts only

Use for Tier A jobs. Everything in `tailor-resume` applies, including its **hard rules** (no invented numbers, tools, titles, credentials or padding; gaps are reported, not covered). This skill adds research and tighter editing.

## 1. Understand the job (before touching the resume)

Read the full description and write down:
- **What the person will actually do** day to day (models built, coverage universe, reports produced, who they support).
- **What the team cares about** - what is listed first, repeated, or in bold.
- **Seniority and timing** - internship vs analyst, Class of 2027, program structure.
- **Tools and credentials asked for**, and which the user truly has.

## 2. Research the firm and team (web search; cite sources in notes)

- Firm: strategy, AUM / size, products, recent news, how the group is organised (official site, annual report, regulatory filings, reputable press first).
- Sector or desk: the themes the team covers (e.g. power and utilities, midstream, data-center infrastructure, credit) and the vocabulary practitioners use.
- Interviewers' or team leads' public work, if available.
Use this to choose *emphasis and vocabulary*. Do not import claims about the user from research. Only the user's own facts go on the resume.

## 3. Map the user's true experience to the job

Build a short table: *job requirement -> closest true experience -> exact source line in the base resume*. Where there is no true match, the row becomes a **gap**.

Look for true material in the base resume such as: research or evaluation work, models built, reports or committee materials produced, coverage areas, quantitative or technical work, coursework, competitions and projects. Use only what is actually there.

## 4. Edit a copy of the user's resume

- **Summary:** 2-3 lines, role-specific, only claims the resume supports.
- **Experience:** reorder and trim bullets so the best-matching true work leads. Reword to the posting's vocabulary where it is an honest description. Keep numbers exactly as in the base; do not add new ones.
- **Skills:** reorder; add nothing the user does not have.
- **Education / certifications:** exact, including expected graduation (May 2027) and credential status.
- Plain, specific wording; short sentences; no buzzword strings. Each bullet should read like something the user could explain in an interview.

## 5. Check before saving

- Every bullet traces to the base resume or something the user said.
- Dates, titles, employers, degrees unchanged.
- Keywords the posting asks for appear where true; nothing added just to hit a score.
- 1 page unless the base needs 2; ATS-safe (no tables / text boxes / images for content; standard section names).
- Contact info and links correct and clickable.

## 6. Output

`data/resumes/{company-slug}-{jobId}/FirstName_LastName_Resume.docx` and `notes.md` containing: job summary, research sources, requirement -> evidence table, changes made, **gaps**, **questions for the user**, and interview-prep talking points (the true stories behind each emphasised bullet).

## Rules

1. True facts only; ask when unsure.
2. Research informs emphasis, never content about the user.
3. Report gaps; never hide them.
4. Original resume is never overwritten.
5. One folder per job; clean standard filename.
