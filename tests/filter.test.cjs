// Run: node tests/filter.test.cjs   (or: npm test)
// Checks scripts/greenhouse-filter.cjs against hand-written postings that mirror the target spec.
const assert = require('assert');
const path = require('path');
const { evaluate, loadSpec } = require('../scripts/greenhouse-filter.cjs');

const spec = loadSpec(path.join(__dirname, '..', 'config', 'search-spec.json'));
const J = (title, location, department = '', description = '') => ({ title, location, department, description, updatedAt: new Date().toISOString() });

// [label, job, expectedKeep, optional reason prefix / extra check]
const cases = [
  ['finance intern NYC',            J('Financial Analyst Intern', 'New York, NY', 'Finance', 'Support FP&A and treasury; Excel modeling.'), true],
  ['equity research class of 2027', J('Equity Research Analyst - Class of 2027', 'Boston, MA', 'Research', 'Full-time analyst program starting summer 2027. Buy-side fundamental research.'), true],
  ['project finance Houston',       J('Project Finance Analyst', 'Houston, TX', 'Infrastructure', 'Renewable and midstream project finance models. 1+ years of experience.'), true],
  ['supply chain finance remote',   J('Supply Chain Finance Analyst', 'Remote - US', 'Finance', 'Working capital, receivables and trade finance programs.'), true],
  ['generic business analyst w/ finance dept', J('Business Analyst', 'San Francisco, CA', 'Finance', 'Treasury, financial planning, FP&A support, valuation.'), true],
  ['wealth associate Dallas',       J('Associate, Wealth Management', 'Dallas, TX', 'Wealth', 'Private wealth client portfolios.'), true],
  ['manager research exception',    J('Manager Research Analyst', 'Chicago, IL', 'Investments', 'Evaluate fund managers, asset management, due diligence.'), true],
  ['credit analyst 3 yrs',          J('Credit Analyst', 'Charlotte, NC', 'Credit', 'Requires 3 years of experience in credit.'), true],

  ['senior title',                  J('Senior Financial Analyst', 'New York, NY', 'Finance'), false, 'too-senior'],
  ['numeral level II',              J('Financial Analyst II', 'New York, NY', 'Finance'), false, 'too-senior'],
  ['software engineer',             J('Software Engineer, Finance Systems', 'New York, NY', 'Engineering'), false, 'non-finance-domain'],
  ['market research analyst',       J('Market Research Analyst', 'Austin, TX', 'Marketing'), false, 'non-finance-domain'],
  ['security analyst',              J('Security Analyst', 'Denver, CO', 'IT'), false, 'non-finance-domain'],
  ['data analyst no finance',       J('Data Analyst', 'Seattle, WA', 'Product', 'Dashboards for product growth and user retention.'), false, 'no-finance-context'],
  ['non-analyst title',             J('Wealth Management Specialist', 'Dallas, TX', 'Wealth'), false, 'not-analyst-level-title'],
  ['research analyst biotech',      J('Research Analyst', 'Boston, MA', 'Biology', 'Lab research on assays.'), false, 'no-finance-context'],
  ['London',                        J('Investment Analyst', 'London, UK', 'Investments'), false, 'non-us-location'],
  ['remote India',                  J('Fixed Income Analyst', 'Remote - India', 'Investments'), false, 'non-us-location'],
  ['5+ years',                      J('Credit Analyst', 'Charlotte, NC', 'Credit', 'Requires 5+ years of relevant experience in credit.'), false, 'requires-5'],
  ['summer 2026 (wrong cycle)',     J('Summer 2026 Investment Analyst Intern', 'New York, NY', 'Investments'), false, 'wrong-class-year'],

  // graduate-student handling
  ['undergrad-only intern',         J('Investment Analyst Intern', 'New York, NY', 'Investments', "Open to rising juniors and seniors currently pursuing a bachelor's degree."), false, 'undergrad-only'],
  ['undergraduate program',         J('Equity Research Summer Analyst', 'Boston, MA', 'Research', 'Our undergraduate internship program for equity research.'), false, 'undergrad-only'],
  ['undergrad AND graduate welcome', J('Asset Management Summer Analyst', 'Boston, MA', 'Investments', 'Undergraduate and graduate students welcome. Fund research and asset management.'), true],
  ['bachelor required is fine',     J('Financial Analyst', 'Chicago, IL', 'Finance', "Bachelor's degree required; master's a plus. FP&A and forecasting."), true],
  ['MBA / master program',          J('Equity Research Associate (MBA / MS)', 'New York, NY', 'Research', "Program for master's and MBA candidates. Buy-side research."), true],
];

let failed = 0;
for (const [label, job, expectKeep, reason] of cases) {
  const r = evaluate(job, spec);
  let ok = r.keep === expectKeep && (!reason || (r.reason || '').startsWith(reason));
  if (!ok) { failed++; console.log('FAIL  ' + label + '  -> keep=' + r.keep + ' reason=' + r.reason + ' score=' + r.score); }
  else console.log('ok    ' + label + (r.keep ? '  (score ' + r.score + ', tier ' + r.tier + ')' : '  (' + r.reason + ')'));
}

// Extra checks
const intern = evaluate(J('Financial Analyst Intern', 'New York, NY', 'Finance', 'Excel.'), spec);
assert(intern.flags.some((f) => /confirm eligibility/.test(f)), 'internship should carry an eligibility flag');
assert(spec.titles.useSuggested === true, 'suggested titles are enabled in the spec');
const specOff = JSON.parse(JSON.stringify(spec)); specOff.titles.useSuggested = false;
const dd = J('Fund Due Diligence Analyst', 'Chicago, IL', '', 'Asset management manager research.');
const ddOn = evaluate(dd, spec);
const ddOff = evaluate(dd, specOff);
assert(ddOn.keep && ddOn.roleKind === 'suggested', 'suggested title should score as suggested when enabled');
console.log('ok    suggested titles: off -> ' + (ddOff.keep ? ddOff.roleKind : ddOff.reason) + ' | on -> ' + ddOn.roleKind);

// graduate-eligible bonus
const gradJob = evaluate(J('Equity Research Associate (MBA / MS)', 'New York, NY', 'Research', "Program for master's and MBA candidates. Buy-side research."), spec);
assert(gradJob.matched.graduateEligible, 'graduate-eligible postings should be marked');
console.log('ok    graduate-eligible marked: ' + gradJob.matched.graduateEligible);

// resume variants
const V = [
  ['Equity Research Analyst', 'Boston, MA', 'equity-research'],
  ['Private Equity Analyst', 'New York, NY', 'asset-mgmt-alternatives'],
  ['Investment Analyst, Hedge Fund', 'Greenwich, CT', 'asset-mgmt-alternatives'],
  ['Project Finance Analyst', 'Houston, TX', 'energy-infrastructure'],
  ['Infrastructure Finance Analyst', 'Dallas, TX', 'energy-infrastructure'],
  ['FP&A Analyst', 'Atlanta, GA', 'corporate-finance'],
  ['Financial Analyst Intern', 'New York, NY', 'corporate-finance'],
  ['Supply Chain Finance Analyst', 'Remote - US', 'corporate-finance'],
];
for (const [t, l, want] of V) {
  const r = evaluate(J(t, l, 'Finance', 'Finance role.'), spec);
  assert(r.keep, t + ' should be kept');
  assert.strictEqual(r.variant, want, t + ' -> ' + r.variant + ' (wanted ' + want + ')');
  console.log('ok    variant: ' + t + ' -> ' + r.variant);
}

if (failed) { console.log('\n' + failed + ' failing'); process.exit(1); }
console.log('\nAll tests passed');
