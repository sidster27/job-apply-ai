import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TailoringInput {
  jobId: string;
  jobDescription: string;
  companyName: string;
  jobTitle: string;
  baseResumePath: string; // path to templates/resume-base.txt
}

export interface TailoringOutput {
  resumeTxt: string;
  coverLetterTxt: string;
  matchScore: number; // 0-100
  matchAnalysis: string;
  keywordsFound: string[]; // Keywords from JD that match resume
  keywordsMissing: string[]; // Keywords from JD NOT in resume
  resumePath: string; // saved path
  coverLetterPath: string; // saved path
}

// ---------------------------------------------------------------------------
// Keyword dictionaries
// ---------------------------------------------------------------------------

const TOOLS = [
  'excel', 'vba', 'power query', 'powerpoint', 'python', 'sql', 'r programming', 'matlab', 'sas', 'stata',
  'tableau', 'power bi', 'alteryx', 'snowflake',
  'bloomberg', 'bloomberg terminal', 'factset', 'capital iq', 's&p capital iq', 'capiq', 'pitchbook',
  'refinitiv', 'eikon', 'morningstar', 'morningstar direct', 'preqin', 'ycharts', 'sec edgar', 'edgar',
];

const MODELING = [
  'financial modeling', 'financial modelling', 'dcf', 'discounted cash flow', 'lbo', 'leveraged buyout',
  'comparable company', 'comps', 'precedent transactions', 'three-statement', '3-statement',
  'sensitivity analysis', 'scenario analysis', 'accretion/dilution', 'merger model', 'sum-of-the-parts',
  'valuation', 'forecasting', 'budgeting', 'variance analysis', 'fp&a', 'financial planning',
  'unit economics', 'project finance model', 'credit model', 'earnings model',
];

const MARKETS = [
  'equity', 'equities', 'fixed income', 'credit', 'bonds', 'high yield', 'investment grade',
  'leveraged finance', 'private equity', 'venture capital', 'hedge fund', 'private credit', 'real assets',
  'real estate', 'infrastructure', 'derivatives', 'options', 'commodities', 'etf', 'mutual fund',
  'pms', 'aif', 'alternatives', 'alternative investments', 'structured finance', 'securitization',
  'macro', 'rates', 'fx', 'esg', 'long/short', 'buy-side', 'sell-side',
];

const METHODS = [
  'due diligence', 'investment committee', 'ic memo', 'investment memo', 'portfolio review',
  'performance attribution', 'attribution', 'manager selection', 'fund evaluation', 'manager research',
  'risk management', 'portfolio construction', 'asset allocation', 'stock pitch', 'initiating coverage',
  'industry analysis', 'competitive analysis', 'sector analysis', 'financial statement analysis',
  'ratio analysis', 'cash flow analysis', 'working capital', 'treasury', 'capital allocation', 'm&a',
  'covenant', 'underwriting', 'market research', 'fund shortlisting', 'aum',
];

const CREDENTIALS = [
  'cfa', 'cfa level', 'frm', 'cpa', 'caia', 'cma', 'series 7', 'series 63', 'series 65', 'series 79',
  'series 86', 'series 87', 'sie',
];

const SOFT_SKILLS = [
  'attention to detail', 'detail-oriented', 'analytical', 'quantitative', 'communication',
  'written communication', 'presentation', 'teamwork', 'collaboration', 'cross-functional',
  'stakeholder', 'time management', 'prioritization', 'initiative', 'ownership', 'problem-solving',
  'critical thinking', 'client-facing', 'self-starter',
];

const INDUSTRY_TERMS = [
  'energy', 'renewable', 'power', 'utilities', 'midstream', 'oil and gas', 'infrastructure finance',
  'project finance', 'data center', 'digital infrastructure', 'supply chain finance', 'trade finance',
  'receivables', 'factoring', 'wealth management', 'asset management', 'banking', 'insurance',
  'fintech', 'climate', 'geopolitics', 'corporate finance', 'equity research', 'investment research',
];

// Combine all keyword lists with their categories for structured extraction
const KEYWORD_CATEGORIES: Record<string, string[]> = {
  tools: TOOLS,
  modeling: MODELING,
  markets: MARKETS,
  methods: METHODS,
  credentials: CREDENTIALS,
  softSkills: SOFT_SKILLS,
  industry: INDUSTRY_TERMS,
};

// ---------------------------------------------------------------------------
// Helper: normalize text for keyword matching
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.toLowerCase().replace(/['']/g, "'");
}

/**
 * Check whether a keyword appears in the given text. Uses word-boundary-aware
 * matching for short keywords to avoid false positives (e.g. "r" inside "react").
 */
function keywordPresent(keyword: string, normalizedText: string): boolean {
  if (keyword.length <= 3) {
    // For very short keywords (e.g. "fx", "dcf", "cfa", "sie"), require word boundaries
    const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
    return pattern.test(normalizedText);
  }
  return normalizedText.includes(keyword);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract keywords from a job description, categorized as required, preferred,
 * and technologies (here: tools, models and credentials).
 *
 * "Required" keywords are those found near requirement-related language.
 * "Preferred" keywords are those found near nice-to-have language.
 * "Technologies" captures every technology/tool/language keyword found.
 */
export function extractKeywords(jobDescription: string): {
  required: string[];
  preferred: string[];
  technologies: string[];
} {
  const normalizedJD = normalize(jobDescription);

  // Split into rough sections to distinguish required vs preferred
  const requiredSectionPattern =
    /(?:requirements?|qualifications?|must have|minimum|basic|what you(?:'ll)? need)[\s\S]*?(?=(?:preferred|nice to have|bonus|benefits|about us|responsibilities|$))/gi;
  const preferredSectionPattern =
    /(?:preferred|nice to have|bonus|ideally|plus|desired)[\s\S]*?(?=(?:requirements?|qualifications?|benefits|about us|responsibilities|$))/gi;

  const requiredSections = (normalizedJD.match(requiredSectionPattern) || []).join(' ');
  const preferredSections = (normalizedJD.match(preferredSectionPattern) || []).join(' ');

  const allTechKeywords: string[] = [];
  const requiredKeywords: string[] = [];
  const preferredKeywords: string[] = [];

  // Scan every category for matches against the full JD
  const techCategories = ['tools', 'modeling', 'credentials'];

  for (const [category, words] of Object.entries(KEYWORD_CATEGORIES)) {
    for (const word of words) {
      if (!keywordPresent(word, normalizedJD)) continue;

      // It appears somewhere in the JD
      if (techCategories.includes(category)) {
        allTechKeywords.push(word);
      }

      if (requiredSections && keywordPresent(word, requiredSections)) {
        requiredKeywords.push(word);
      } else if (preferredSections && keywordPresent(word, preferredSections)) {
        preferredKeywords.push(word);
      } else {
        // Found in JD but not clearly in a required/preferred section — treat as required
        requiredKeywords.push(word);
      }
    }
  }

  return {
    required: [...new Set(requiredKeywords)],
    preferred: [...new Set(preferredKeywords)],
    technologies: [...new Set(allTechKeywords)],
  };
}

/**
 * Compare a resume against a job description and compute a match score.
 *
 * Score = (matched keywords / total JD keywords) * 100
 */
export function computeMatchScore(
  resumeText: string,
  jobDescription: string
): { score: number; matched: string[]; missing: string[] } {
  const normalizedResume = normalize(resumeText);
  const normalizedJD = normalize(jobDescription);

  // Collect every keyword that appears in the JD
  const jdKeywords: string[] = [];
  for (const words of Object.values(KEYWORD_CATEGORIES)) {
    for (const word of words) {
      if (keywordPresent(word, normalizedJD)) {
        jdKeywords.push(word);
      }
    }
  }

  const uniqueJDKeywords = [...new Set(jdKeywords)];

  if (uniqueJDKeywords.length === 0) {
    return { score: 0, matched: [], missing: [] };
  }

  const matched: string[] = [];
  const missing: string[] = [];

  for (const keyword of uniqueJDKeywords) {
    if (keywordPresent(keyword, normalizedResume)) {
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  const score = Math.round((matched.length / uniqueJDKeywords.length) * 100);

  return { score, matched, missing };
}

/**
 * Save tailored resume and cover letter to data/resumes/{jobId}/.
 * Creates directories as needed and returns the saved file paths.
 */
export function saveTailoredDocuments(
  jobId: string,
  resumeTxt: string,
  coverLetterTxt: string
): { resumePath: string; coverLetterPath: string } {
  const outputDir = path.resolve(__dirname, '../../data/resumes', jobId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const resumePath = path.join(outputDir, 'resume.txt');
  const coverLetterPath = path.join(outputDir, 'cover_letter.txt');

  fs.writeFileSync(resumePath, resumeTxt, 'utf-8');
  fs.writeFileSync(coverLetterPath, coverLetterTxt, 'utf-8');

  console.log(`[resume-tailor] Saved resume to ${resumePath}`);
  console.log(`[resume-tailor] Saved cover letter to ${coverLetterPath}`);

  return { resumePath, coverLetterPath };
}

/**
 * Generate a tailoring prompt that Claude (or another LLM) can use to
 * produce a tailored resume and cover letter.
 *
 * The prompt includes the base resume, the full job description, keyword
 * analysis, and specific instructions for how to tailor the content.
 */
export function generateTailoringPrompt(input: TailoringInput): string {
  // Read the base resume
  let baseResume: string;
  try {
    baseResume = fs.readFileSync(input.baseResumePath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read base resume at ${input.baseResumePath}. ` +
        'Copy templates/resume-base.example.txt to templates/resume-base.txt and fill in your real resume text (the file is git-ignored).'
    );
  }

  // Run keyword extraction and match scoring
  const keywords = extractKeywords(input.jobDescription);
  const { score, matched, missing } = computeMatchScore(baseResume, input.jobDescription);

  const prompt = `You are an expert resume writer and career coach. Given the following job description for **${input.jobTitle}** at **${input.companyName}**, and the base resume below, create a tailored resume and cover letter.

---

## Job Description

${input.jobDescription}

---

## Base Resume

${baseResume}

---

## Keyword Analysis

- **Current match score:** ${score}/100
- **Keywords already in resume:** ${matched.join(', ') || 'none'}
- **Keywords missing from resume:** ${missing.join(', ') || 'none'}
- **Required keywords from JD:** ${keywords.required.join(', ') || 'none'}
- **Preferred keywords from JD:** ${keywords.preferred.join(', ') || 'none'}
- **Tools, models and credentials mentioned in JD:** ${keywords.technologies.join(', ') || 'none'}

---

## Instructions

Create a tailored version of the resume that:

1. **Reorders bullet points** so the experience most relevant to this role comes first.
2. **Mirrors the job description's vocabulary** where it honestly describes work already on the base resume (e.g. say "equity research" instead of "stock analysis" only if that is what the work was).
3. **Adjusts the summary** to the language and priorities of the job description.
4. **Keeps every fact true.** Use ONLY facts, numbers, tools, titles and dates that appear in the base resume or that the applicant has told you. Do NOT invent metrics, add bullets about work that was not done, or add tools/skills/credentials the applicant does not have.
5. **Lists gaps instead of covering them.** Put any job requirement the resume cannot honestly support in the MATCH ANALYSIS as a gap for the applicant to decide on - never onto the page.
6. **Keeps the resume to 1 page** (2 only if the base resume already needs it).

Then generate a **cover letter** specific to this role that:

1. Opens with a compelling hook referencing the company or role specifically.
2. Highlights 2-3 of the strongest matching qualifications with concrete examples.
3. Addresses gaps honestly (what the applicant is actively building), without overstating experience.
4. Closes with enthusiasm and a clear call to action.
5. Is no longer than one page.

---

## Output Format

Return the output in the following format:

### TAILORED RESUME START ###
[The full tailored resume text here]
### TAILORED RESUME END ###

### COVER LETTER START ###
[The full cover letter text here]
### COVER LETTER END ###

### MATCH ANALYSIS ###
[A brief paragraph analyzing how well this candidate fits the role and any risks/gaps]
### MATCH ANALYSIS END ###
`;

  return prompt;
}

/**
 * Parse the output from an LLM that followed the generateTailoringPrompt format
 * and return a full TailoringOutput.
 */
export function parseTailoringResponse(
  input: TailoringInput,
  llmResponse: string
): TailoringOutput {
  // Extract sections from the LLM response
  const resumeMatch = llmResponse.match(
    /### TAILORED RESUME START ###\s*([\s\S]*?)\s*### TAILORED RESUME END ###/
  );
  const coverLetterMatch = llmResponse.match(
    /### COVER LETTER START ###\s*([\s\S]*?)\s*### COVER LETTER END ###/
  );
  const analysisMatch = llmResponse.match(
    /### MATCH ANALYSIS ###\s*([\s\S]*?)\s*### MATCH ANALYSIS END ###/
  );

  const resumeTxt = resumeMatch ? resumeMatch[1].trim() : llmResponse;
  const coverLetterTxt = coverLetterMatch ? coverLetterMatch[1].trim() : '';
  const matchAnalysis = analysisMatch ? analysisMatch[1].trim() : '';

  // Compute match score against the tailored resume
  const { score, matched, missing } = computeMatchScore(resumeTxt, input.jobDescription);

  // Save to disk
  const { resumePath, coverLetterPath } = saveTailoredDocuments(
    input.jobId,
    resumeTxt,
    coverLetterTxt
  );

  return {
    resumeTxt,
    coverLetterTxt,
    matchScore: score,
    matchAnalysis,
    keywordsFound: matched,
    keywordsMissing: missing,
    resumePath,
    coverLetterPath,
  };
}
