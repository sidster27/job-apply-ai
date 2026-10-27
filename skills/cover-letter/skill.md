---
name: cover-letter
description: Generate job-specific cover letters with links and proof points. Use when the user says "cover letter", "write cover letter", "generate cover letter", or "cover letter for [company]". Produces .txt and .docx files.
---

# Cover Letter Generation Skill

Generates job-specific, professional cover letters for the applicant.

## When To Write a Cover Letter

**Most companies don't care.** Only write one if:
- The application form has a **required** cover letter upload field
- It's a **dream company** where standing out matters
- The user specifically asks for one

**Skip for:** Most Greenhouse apps, most Lever apps, any form that doesn't ask.

## Tone & Style

- **Professional and direct** — finance recruiters expect a polished, concise tone; warm but not chatty
- **Confident, factual** — state what was done and what it showed. No overselling
- **Short** — 3 short paragraphs, under one page
- **First person, plain words** — no buzzword strings
- **True facts only** — every claim and number must come from the applicant's resume or profile; never invent metrics or experience
- **Never use**: "leverage", "synergy", "passionate about", "thrilled to", "I believe I would be a great fit"
- **Do use**: the specific team / strategy / sector, one or two concrete proof points, why this firm

## Links to Include (from config/profile.json)

Pull all relevant links from the applicant's profile:
- LinkedIn URL
- Portfolio / patent / GitHub / GitLab links
- Any relevant award or achievement URLs

## Letter Structure

### 1. Opening (Job-Specific)

Detect job type from JD and use matching opener:

| JD Type | Detection | Opening |
|---------|-----------|---------|
| Equity / buy-side research | equity research, buy-side, fundamental, coverage | Lead with research work, coverage, models and pitches the applicant has actually done |
| Asset mgmt / alternatives | asset management, private equity, venture, hedge fund, fund | Lead with fund / manager evaluation, attribution, IC materials |
| Infrastructure / energy finance | project finance, infrastructure, energy, utilities, data center | Lead with the closest true modelling or sector work; be honest about what is being built |
| Corporate finance / FP&A | corporate finance, FP&A, treasury, supply chain finance | Lead with modelling, forecasting, working-capital or analysis work |
| Credit / fixed income | credit, fixed income, bonds | Lead with credit / risk analysis the applicant has done |
| Wealth management | wealth, private bank, advisor | Lead with portfolio review, product research, client-facing work |
| Generic | (default) | Lead with the strongest relevant experience and the applicant's degree program |

### 2. Tools / Method Match (If JD Mentions Them)

Format: "The role uses [Bloomberg / FactSet / DCF and comps modelling ...] — [where I have used it]"

Only mention tools and methods the applicant has really used (from `config/profile.json` / the resume). If a key requirement is not met, do not claim it.

### 3. Proof Points (Pick 2-4 Based on Job Type)

Draw from the applicant's most impressive achievements:
- **Research / analysis work**: models, reports, IC materials, fund evaluations and what they led to
- **Scale of responsibility**: assets, funds or products covered (use only figures the applicant has confirmed)
- **Education and competitions**: relevant coursework, pitch competitions, certifications in progress (state status exactly)
- **AI + finance**: only if the applicant has actually built or used it

### 4. Closer (Keep It Short)

Something like:
- "Happy to chat more about any of this — I think there's a good fit here."
- "Would love to talk more about what you're building."
- "Let me know if you'd like to dig into any of this."

NOT: "I would welcome the opportunity to connect and discuss how I can contribute to your esteemed organization."

### 5. Links Footer

```
- LinkedIn: [url from profile]
- Portfolio/Patent: [url from profile]
- GitHub/GitLab: [url from profile]

[Preferred Name]
[email] | [phone]
```

Sign off with preferred name, not full formal name — casual.

## DOCX Formatting

### Header
```
[Full Name] (large bold)
[email]  |  [phone] (medium, muted color)
[LinkedIn]  |  [Portfolio]  |  [GitHub] (clickable hyperlinks)
─────────────────────────────── (bottom border)
[Current Date] (medium, muted color)
```

### Body
- **"Dear Hiring Manager,"** — medium size, spacing after
- **Body paragraphs** — medium size, spacing after
- **Bullet points (•)** — medium size, indented, spacing after
- **Bullets with URLs** — URL portion as clickable hyperlink
- **"Best regards,"** — spacing before
- **Name** — bold
- **Link labels** — bold label + clickable URL

### Page
- Margins: ~0.625 inches all sides
- All hyperlinks: colored, underlined, clickable

## Rules

- **Every cover letter must reference the specific role and company by name**
- **Tech stack match paragraph only if JD mentions specific technologies**
- **Links**: include LinkedIn and any portfolio / pitch links the applicant has
- **Never say "you should hire me"** — let the achievements speak
- **Never mention salary, visa status, or relocation** in cover letter
- **Generate both .txt and .docx** for every cover letter
- **File naming**: `[FirstName]_[LastName]_Cover_Letter.txt` and `.docx`
- **Save to**: `data/resumes/{company-slug}-{jobId}/` (same folder as the resume)
