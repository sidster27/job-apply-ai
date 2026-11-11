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

  // protected phrases, MBA-only, AI enablement (v3)
  ['sales & trading analyst kept',  J('Sales & Trading Summer Analyst', 'New York, NY', 'Markets', 'Global markets, fixed income and equities. Master\'s students welcome.'), true],
  ['sales and trading full-time',   J('Global Markets Sales and Trading Analyst - 2027', 'New York, NY', 'Markets', 'Full-time analyst program starting summer 2027.'), true],
  ['principal investing analyst',   J('Principal Investing Analyst', 'Boston, MA', 'Investments', 'Private equity and growth investing.'), true],
  ['plain sales still dropped',     J('Sales Analyst', 'New York, NY', 'Sales', 'Quota-carrying software sales support, finance a plus.'), false, 'non-finance-domain'],
  ['MBA-only internship',           J('Private Equity Summer Associate', 'New York, NY', 'Investments', 'Open to first-year MBA candidates only.'), false, 'mba-only'],
  ['MBA and master welcome',        J('Private Equity Summer Associate', 'New York, NY', 'Investments', "Open to MBA and master's students."), true],
  ['AI enablement analyst (finance)', J('AI Enablement Analyst', 'New York, NY', 'Investments', 'Drive adoption of generative AI across the investment and portfolio teams of an asset manager.'), true],
  ['AI analyst at a non-finance firm', J('AI Analyst', 'San Francisco, CA', 'Product', 'Improve our SaaS onboarding assistant and user retention.'), false, 'no-finance-context'],
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

// resume variants (six final resumes; unseen titles fall back to 'base' so tailor-resume researches them)
const V = [
  ['Equity Research Analyst', 'Boston, MA', 'equity-research'],
  ['Research Associate, Macro Research', 'New York, NY', 'equity-research'],
  ['Investment Banking Summer Analyst', 'New York, NY', 'ib-pe'],
  ['Private Equity Analyst', 'New York, NY', 'ib-pe'],
  ['Corporate Development Analyst', 'Chicago, IL', 'ib-pe'],
  ['Sales & Trading Summer Analyst', 'New York, NY', 'trading-investments'],
  ['Quantitative Research Analyst', 'Chicago, IL', 'trading-investments'],
  ['Portfolio Analytics Analyst', 'Boston, MA', 'asset-mgmt-portfolio-analytics'],
  ['Investment Analyst, Asset Management', 'Boston, MA', 'asset-mgmt-portfolio-analytics'],
  ['AI Enablement Analyst', 'New York, NY', 'asset-mgmt-portfolio-analytics'],
  ['Project Finance Analyst', 'Houston, TX', 'project-finance-energy-infra'],
  ['Infrastructure Finance Analyst', 'Dallas, TX', 'project-finance-energy-infra'],
  ['Manager Due Diligence Analyst', 'Chicago, IL', 'alternatives-manager-dd'],
  ['Private Credit Analyst', 'New York, NY', 'alternatives-manager-dd'],
  ['Hedge Fund Analyst', 'Greenwich, CT', 'alternatives-manager-dd'],
  // no variant fits -> base -> tailor-resume researches the title and picks the nearest variant
  ['FP&A Analyst', 'Atlanta, GA', 'base'],
  ['Supply Chain Finance Analyst', 'Remote - US', 'base'],
  ['Financial Analyst Intern', 'New York, NY', 'base'],
];
const DESC = { 'AI Enablement Analyst': 'Drive adoption of generative AI across the investment and portfolio teams of an asset manager.' };
for (const [t, l, want] of V) {
  const r = evaluate(J(t, l, 'Finance', DESC[t] || 'Finance role. Investments and portfolio work.'), spec);
  assert(r.keep, t + ' should be kept (reason: ' + r.reason + ')');
  assert.strictEqual(r.variant, want, t + ' -> ' + r.variant + ' (wanted ' + want + ')');
  console.log('ok    variant: ' + t + ' -> ' + r.variant);
}
const base = evaluate(J('FP&A Analyst', 'Atlanta, GA', 'Finance', 'Finance role.'), spec);
assert(base.flags.some((f) => /research it/.test(f)), 'base variant should carry a research flag');

// a learned title overrides the keyword match (uses a temporary title map)
{
  const fs = require('fs');
  const mapPath = path.join(__dirname, '..', 'config', 'role-title-map.json');
  const original = fs.readFileSync(mapPath, 'utf8');
  try {
    const m = JSON.parse(original); m.learned['fp&a analyst'] = 'ib-pe';
    fs.writeFileSync(mapPath, JSON.stringify(m, null, 2));
    delete require.cache[require.resolve('../scripts/greenhouse-filter.cjs')];
    const fresh = require('../scripts/greenhouse-filter.cjs');
    const r = fresh.evaluate(J('FP&A Analyst', 'Atlanta, GA', 'Finance', 'Finance role.'), spec);
    assert.strictEqual(r.variant, 'ib-pe', 'learned title should be used');
    console.log('ok    learned title: FP&A Analyst -> ib-pe');
  } finally {
    fs.writeFileSync(mapPath, original);
    delete require.cache[require.resolve('../scripts/greenhouse-filter.cjs')];
  }
}

if (failed) { console.log('\n' + failed + ' failing'); process.exit(1); }
console.log('\nAll tests passed');
