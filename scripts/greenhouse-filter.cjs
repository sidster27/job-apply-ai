#!/usr/bin/env node
/**
 * Filter + score pulled jobs against config/search-spec.json
 * (finance analyst / research / internship targeting).
 *
 * Usage:
 *   node scripts/greenhouse-filter.cjs
 *   node scripts/greenhouse-filter.cjs --input data/jobs/greenhouse-jobs.json --output data/jobs/greenhouse-filtered.json
 *   node scripts/greenhouse-filter.cjs --with-suggested      # force suggested titles on (the spec has useSuggested: true)
 *   node scripts/greenhouse-filter.cjs --min-score 40 --show 50
 *   node scripts/greenhouse-filter.cjs --spec config/search-spec.json
 *
 * Reads  data/jobs/greenhouse-jobs.json (output of greenhouse-pull.cjs)
 * Writes data/jobs/greenhouse-filtered.json  (kept jobs sorted by score, plus removed jobs with reasons)
 *
 * This is a fast first pass (title/department/location/description heuristics).
 * The job-filters skill then has Claude read the full job descriptions of what survives.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Term matching ("financ*" = prefix match, everything else = whole-word match)
// ---------------------------------------------------------------------------

const reCache = new Map();
function termRegex(term) {
  if (reCache.has(term)) return reCache.get(term);
  const prefix = term.endsWith('*');
  const core = term.replace(/\*$/, '').toLowerCase().replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const re = new RegExp('(?:^|[^a-z0-9])' + core + (prefix ? '' : '(?:[^a-z0-9]|$)'), 'i');
  reCache.set(term, re);
  return re;
}

/** Returns the list of terms (from `terms`) found in `text`. */
function hits(text, terms) {
  const t = String(text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return (terms || []).filter((term) => termRegex(term).test(t));
}

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_STATE_ABBR_RE = new RegExp(',\\s*(' + US_STATES + ')\\b');
const US_WORDS_RE = /united states|\busa\b|\bu\.s\.?(?:a\.?)?\b|\bus\b/i;

// ---------------------------------------------------------------------------
// Evaluation of a single job
// ---------------------------------------------------------------------------

/** Pull the highest "N years" experience requirement out of a description. */
function maxYearsRequired(description) {
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?[’']?\s+(?:of\s+)?(?:[a-z-]+\s+){0,3}?(?:experience|in\s|working)/gi;
  let max = 0;
  let m;
  while ((m = re.exec(description || '')) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max && n < 30) max = n;
  }
  return max;
}

/** Class-year signal: 'match' (2027), 'wrong' (other cycle only) or null. */
function classYearSignal(text, classYear) {
  const ctx = '(?:class of|graduat\\w*|summer|fall|spring|winter|start\\w*|beginning|full[- ]time|analyst program|intern\\w*|co-?op)';
  const mk = (y) => new RegExp('\\b' + ctx + '\\b[^.]{0,40}\\b' + y + '\\b|\\b' + y + '\\b[^.]{0,40}\\b' + ctx + '\\b', 'i');
  if (mk(classYear).test(text)) return 'match';
  for (const y of [classYear - 1, classYear + 1, classYear + 2]) {
    if (mk(y).test(text)) return 'wrong';
  }
  return null;
}

/** Pick the resume variant for a job: title terms weigh 3, sector hits weigh 1; no match -> 'base'. */
function pickVariant(title, sectorsHit, spec) {
  const variants = spec.resumeVariants || {};
  let best = 'base';
  let bestScore = 0;
  for (const [id, v] of Object.entries(variants)) {
    if (id.startsWith('_') || id === 'base') continue;
    const s = 3 * hits(title, v.matchTitles).length + (sectorsHit || []).filter((k) => (v.matchSectors || []).includes(k)).length;
    if (s > bestScore) { best = id; bestScore = s; }
  }
  return best;
}

/**
 * Returns { keep, reason?, score?, tier?, flags[], matched{} } for one job.
 * Pure function: everything it needs comes from `job` and `spec`.
 */
function evaluate(job, spec, opts = {}) {
  const useSuggested = opts.withSuggested || spec.titles.useSuggested;
  const sc = spec.scoring;
  const title = String(job.title || '');
  const dept = String(job.department || '');
  const loc = String(job.location || '');
  const desc = String(job.description || '');
  const flags = [];
  const matched = {};
  const drop = (reason) => ({ keep: false, reason, flags, matched });

  // 1. Level exclusions in the title (with exceptions like "manager research")
  let titleForLevel = title.toLowerCase();
  for (const ex of spec.exclude.levelExceptions || []) titleForLevel = titleForLevel.split(ex).join(' ');
  const levelHit = hits(titleForLevel, spec.exclude.levelInTitle);
  if (levelHit.length) return drop('too-senior: ' + levelHit[0]);

  // 2. Non-finance domain exclusions in the title
  const domainHit = hits(title, spec.exclude.domainInTitle);
  if (domainHit.length) return drop('non-finance-domain: ' + domainHit[0]);

  // 3. Must look like an entry-level / analyst-type title
  const entryHit = hits(title, spec.titles.entryWords);
  if (!entryHit.length) return drop('not-analyst-level-title');

  // 3b. Graduate student: drop postings specifically for undergraduate / bachelor's students,
  //     unless they also welcome graduate students. A plain "Bachelor's required" is fine.
  const degreeText = title + ' ' + desc;
  const ugHit = hits(degreeText, spec.exclude.undergradOnly);
  const gradHit = hits(degreeText, spec.exclude.graduateEligible);
  if (ugHit.length && !gradHit.length) return drop('undergrad-only: ' + ugHit[0]);

  // 4. Role match: strong / suggested title term, else finance context
  const ctxTerms = spec.financeContext.terms;
  const ctxInTitleDept = hits(title + ' ' + dept, ctxTerms);
  const ctxInDesc = hits(desc, ctxTerms);
  const hasContext = ctxInTitleDept.length > 0 || ctxInDesc.length >= spec.financeContext.descriptionHitsNeeded;

  const strongHit = hits(title, spec.titles.strong);
  const suggestedHit = useSuggested ? hits(title, spec.titles.suggested) : [];
  const ambiguous = (spec.titles.strongNeedsContext || []).map((t) => t.toLowerCase());
  const strongOk = strongHit.filter((t) => !ambiguous.includes(t.toLowerCase()) || hasContext);

  let roleKind;
  let score = 0;
  if (strongOk.length) { roleKind = 'strong'; score += sc.titleStrong; matched.titleTerms = strongOk; }
  else if (suggestedHit.length) { roleKind = 'suggested'; score += sc.titleSuggested; matched.titleTerms = suggestedHit; }
  else if (hasContext) { roleKind = 'entry+finance-context'; score += sc.titleEntryWithFinanceContext; matched.titleTerms = entryHit; }
  else return drop('no-finance-context');

  // 5. Location
  const nonUS = hits(loc, spec.exclude.nonUSLocations);
  const usSignal = US_WORDS_RE.test(loc) || US_STATE_ABBR_RE.test(loc) || hits(loc, spec.locations.hubs).length > 0;
  const isRemote = /remote/i.test(loc);
  const unknownLoc = !loc.trim() || /^unknown$/i.test(loc.trim());
  if (nonUS.length && !usSignal) return drop('non-us-location: ' + nonUS[0]);
  if (isRemote && !spec.locations.allowRemote) return drop('remote-not-wanted');
  if (unknownLoc) {
    if (!spec.locations.keepUnknown) return drop('unknown-location');
    flags.push('location unknown - check posting');
  }
  const hub = hits(loc, spec.locations.hubs);
  if (hub.length) { score += sc.hubLocation; matched.hub = hub[0]; }
  if (usSignal && !isRemote) score += sc.inPersonUS;

  // 6. Class year / timing
  const classYear = spec.candidate.classYear;
  const cy = classYearSignal(title + ' ' + desc, classYear);
  if (cy === 'wrong' && spec.candidate.dropWrongClassYear) return drop('wrong-class-year');
  if (cy === 'match') { score += sc.classYearMatch; matched.classYear = classYear; }

  // 7. Level points + internship eligibility flag
  const isIntern = hits(title, ['intern', 'internship', 'summer analyst', 'summer associate']).length > 0;
  if (hits(title, ['analyst', 'intern', 'internship', 'trainee', 'program', 'summer analyst']).length) score += sc.levelAnalystOrIntern;
  else score += sc.levelAssociate;
  if (isIntern && cy !== 'match') {
    flags.push('internship - confirm eligibility (graduating May ' + classYear + ')');
    score += sc.internshipEligibilityCheck;
  }

  // 8. Experience requirement
  const years = maxYearsRequired(desc);
  if (years >= spec.exclude.yearsHardDropAt) return drop('requires-' + years + '+-years');
  if (years === spec.exclude.maxMinYearsRequired) { score += sc.yearsThree; flags.push('asks for ' + years + '+ years'); }

  // 9. Sector points (distinct sectors hit)
  const sectorText = title + ' ' + dept + ' ' + desc;
  const sectorsHit = Object.keys(spec.sectors)
    .filter((k) => !k.startsWith('_'))
    .filter((k) => hits(sectorText, spec.sectors[k]).length > 0);
  score += Math.min(sc.sectorPointsCap, sectorsHit.length * sc.sectorPointsEach);
  matched.sectors = sectorsHit;

  // 9b. Graduate-program bonus (explicitly open to master's / MBA students)
  if (gradHit.length) { score += sc.graduateEligibleBonus || 0; matched.graduateEligible = gradHit[0]; }

  // 10. Freshness
  if (job.updatedAt) {
    const ageDays = (Date.now() - new Date(job.updatedAt).getTime()) / 86400000;
    if (ageDays >= 0 && ageDays <= 3) score += sc.freshWithin3Days;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score < sc.minScoreToKeep) return drop('low-score: ' + score);

  const tier = score >= sc.tiers.A ? 'A' : score >= sc.tiers.B ? 'B' : 'C';
  const variant = pickVariant(title, sectorsHit, spec);
  return { keep: true, score, tier, roleKind, variant, flags, matched };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadSpec(specPath) {
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const has = (flag) => args.includes(flag);

  const specPath = path.resolve(getArg('--spec') || path.join(BASE, 'config', 'search-spec.json'));
  const inputPath = path.resolve(getArg('--input') || path.join(BASE, 'data', 'jobs', 'greenhouse-jobs.json'));
  const outPath = path.resolve(getArg('--output') || path.join(BASE, 'data', 'jobs', 'greenhouse-filtered.json'));
  const showN = parseInt(getArg('--show') || '25', 10);

  if (!fs.existsSync(inputPath)) {
    console.error('Missing ' + inputPath + '. Run greenhouse-pull.cjs first.');
    process.exit(1);
  }
  const spec = loadSpec(specPath);
  if (getArg('--min-score')) spec.scoring.minScoreToKeep = parseInt(getArg('--min-score'), 10);

  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const jobs = Array.isArray(data) ? data : data.jobs || [];
  console.log('Loaded ' + jobs.length + ' jobs from ' + inputPath);

  const kept = [];
  const removed = [];
  const byReason = {};
  const seen = new Set();
  let dupes = 0;

  for (const job of jobs) {
    const r = evaluate(job, spec, { withSuggested: has('--with-suggested') });
    if (!r.keep) {
      const key = r.reason.split(':')[0];
      byReason[key] = (byReason[key] || 0) + 1;
      removed.push({ id: job.id, company: job.company, title: job.title, location: job.location, reason: r.reason });
      continue;
    }
    const dk = [job.company, job.title, job.location].join('|').toLowerCase();
    if (seen.has(dk)) { dupes++; continue; }
    seen.add(dk);
    kept.push({ ...job, score: r.score, tier: r.tier, roleKind: r.roleKind, resumeVariant: r.variant, flags: r.flags, matched: r.matched });
  }

  kept.sort((a, b) => b.score - a.score || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const tiers = { A: 0, B: 0, C: 0 };
  kept.forEach((j) => { tiers[j.tier]++; });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    filteredAt: new Date().toISOString(),
    inputFile: inputPath,
    specVersion: spec.version,
    usedSuggestedTitles: has('--with-suggested') || !!spec.titles.useSuggested,
    stats: { totalInput: jobs.length, kept: kept.length, duplicatesRemoved: dupes, tiers, removedByReason: byReason },
    jobs: kept,
    removed,
  }, null, 2));

  console.log('\nKept ' + kept.length + ' of ' + jobs.length + '  (A: ' + tiers.A + ' | B: ' + tiers.B + ' | C: ' + tiers.C + ')  duplicates removed: ' + dupes);
  console.log('Removed by reason:');
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(6) + '  ' + k));
  console.log('\nTop ' + Math.min(showN, kept.length) + ':');
  kept.slice(0, showN).forEach((j) => {
    const fl = j.flags.length ? '  [' + j.flags.join('; ') + ']' : '';
    console.log('  [' + j.tier + ' ' + String(j.score).padStart(3) + '] ' + j.company + ' - ' + j.title + ' (' + j.location + ')  <' + j.resumeVariant + '>' + fl);
  });
  console.log('\nSaved to ' + outPath);
}

if (require.main === module) main();

module.exports = { evaluate, loadSpec, hits, maxYearsRequired, classYearSignal, pickVariant };
