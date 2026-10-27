---
name: tailor-resume
description: Tailor the user's resume to a specific finance job description (analyst, research, internship) using only true facts. Use when the user says "tailor resume", "resume for [company]", "optimize resume", or "make resume match". Output is a .docx based on a copy of the user's own resume.
---

# Resume Tailoring (Finance) - truthful by construction

Tailoring means **choosing, ordering and wording true facts for this job**. It never means adding facts.

## Source of truth

1. The user's base resume (`Latest_Resume.docx`, kept in the Job Tracker project or in `templates/`). Work on a **copy**; never overwrite the original.
2. `config/profile.json` (local, git-ignored) and the LinkedIn brief, for dates, titles and contact details.
3. Anything the user tells you in the conversation.

If a fact is not in those places, it does not go on the resume.

## Framing: make the strongest honest case

The goal is the best possible *true* version of the applicant. Do:
- Lead with the most impressive true work for this role and give it room.
- Use strong, specific verbs and say what the work was *for* and who used it (IC, clients, a team decision).
- Spell out real scope: how many funds / products / companies, which asset classes, which tools.
- Use numbers the applicant gives you. If they give an approximation, write it as an approximation ("~"), in their words.
- Connect coursework, projects and competitions to the job when they are real.

Do **not** stretch beyond what happened. If a stronger claim would need a bigger number, a bigger title, a bigger scope, a tool the applicant has not used, or a credential not held, **do not write it**. Ask the applicant for the real detail instead - there is usually a stronger true version than the first draft. Finance employers verify employment, titles and credentials, so an overstated line can cost an offer later.

## Hard rules

- **No invented numbers, metrics, deal sizes, AUM figures, tools, titles, dates, certifications or coursework.**
- **No padding.** Do not add bullets to reach a count and do not "expand" a role with plausible-sounding work. A short role stays short.
- **No keyword stuffing.** A skill appears in the Skills section only if the user actually has it. A job requirement the resume cannot honestly support is reported as a **gap** to the user, not written onto the page.
- **Reframing is allowed:** same facts, vocabulary that matches the posting (e.g. "fund manager due diligence" vs "manager research") when it describes what was actually done.
- Do not claim a credential the user has not earned (CFA Level I passed vs candidate vs not started - state exactly what is true; ask if unsure).
- If unsure whether something is true, **ask the user**; do not guess.

## Steps

1. **Read the job description.** Identify the real work, the sector, what is emphasised (listed first / repeated), seniority, class-year, required tools and credentials.
2. **Use the job's variant** (`resumeVariant` from the filter output; definitions in `config/search-spec.json` -> `resumeVariants`). A variant is an emphasis and ordering choice, **not different content**: the applicant has only a few roles, so employers, titles and dates are identical in every variant. What changes is the summary angle, which work leads, skills order and keywords.
   - `equity-research` - Equity Research / Buy-side research
   - `asset-mgmt-alternatives` - Asset Management & Alternatives
   - `energy-infrastructure` - Energy & Infrastructure Finance
   - `corporate-finance` - Corporate Finance (incl. FP&A, treasury, supply chain finance, credit-type roles)
   - `base` - fallback when nothing clearly fits
   Each variant has its own `.docx` kept locally / in the Job Tracker project. Start from the matching variant file, then tailor to the specific posting.
3. **Score coverage.** Compare JD keywords (`src/tailor/resume-tailor.ts` -> `computeMatchScore`) with the base resume. The score is a *coverage signal*, not a target to hit at any cost. Missing keywords split into:
   - *true but unstated* -> reword an existing bullet to include it
   - *not true / not held* -> list as a gap
4. **Edit the copy:**
   - Reorder roles' bullets so the most relevant true work comes first; trim bullets that distract.
   - Rewrite the summary (2-3 lines) for this role using only true claims.
   - Reorder the Skills section so what the posting asks for and the user truly has comes first.
   - Keep every number exactly as in the base resume.
5. **Check:** every bullet traces to the base resume or user input; dates / titles / employers unchanged; spelling of firm and role names matches the posting; fits 1 page (2 only if the base already needs it).
6. **Report to the user:** what was reordered / reworded, the coverage score before and after, and the **gaps list** (requirements not supported, credentials not held, anything you asked about).

## Formatting

Use the user's own `.docx` as the template: copy it, then replace text paragraph by paragraph (python-docx or direct XML edit), preserving styles, numbering, fonts, margins and links. Do not rebuild the document from scratch. No tables, text boxes or images for content (ATS parsing). Standard section names: SUMMARY, EDUCATION, EXPERIENCE, SKILLS, CERTIFICATIONS.

## Output

Save to `data/resumes/{company-slug}-{jobId}/` as `FirstName_LastName_Resume.docx` (a clean, standard filename; the folder carries the job identity). Also save `notes.md` there with: variant used, coverage before / after, changes made, gaps, open questions.

## Key files

- `config/search-spec.json` - roles, sectors, keywords
- `src/tailor/resume-tailor.ts` - keyword extraction and coverage scoring (finance vocabulary)
- `templates/` - sample resume text for the code path; the real resume and the variant `.docx` files live with the user (git-ignored)
