// Run: node tests/sources.test.cjs   (or: npm test)
// Checks scripts/detect-ats.cjs (URL -> ATS / route / redirect unwrapping) and the sources config.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { detect, unwrap } = require('../scripts/detect-ats.cjs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'job-sources.json'), 'utf8'));
const d = (u, c) => detect(u, c || cfg);

const cases = [
  // [url, ats, route, requiresAccount]
  ['https://job-boards.greenhouse.io/aksia/jobs/4012345', 'greenhouse', 'auto-fill-with-approval', false],
  ['https://boards.greenhouse.io/alphasense', 'greenhouse', 'auto-fill-with-approval', false],
  ['https://jobs.lever.co/acme/abc-123', 'lever', 'auto-fill-with-approval', false],
  ['https://jobs.ashbyhq.com/acme/uuid', 'ashby', 'auto-fill-with-approval', false],
  ['https://pjtpartners.wd1.myworkdayjobs.com/Students/job/New-York/Summer-Analyst_R1', 'workday', 'auto-fill-with-approval', true],
  ['https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers', 'workday', 'auto-fill-with-approval', true],
  ['https://jefferies.tal.net/candidate/jobboard/vacancy/1/adv/', 'talnet', 'auto-fill-with-approval', true],
  ['https://mlp.eightfold.ai/careers', 'eightfold', 'auto-fill-with-approval', false],
  ['https://careers-acme.icims.com/jobs/1234/analyst/job', 'icims', 'auto-fill-with-approval', true],
  ['https://eabc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1', 'oracle-cloud', 'auto-fill-with-approval', true],
  ['https://acme.taleo.net/careersection/2/jobdetail.ftl?job=1', 'taleo', 'auto-fill-with-approval', true],
  ['https://jobs.smartrecruiters.com/Acme/12345-analyst', 'smartrecruiters', 'auto-fill-with-approval', false],
  ['https://acme.applytojob.com/apply/AbC123/Analyst', 'jazzhr', 'auto-fill-with-approval', false],
  ['https://app.joinhandshake.com/stu/jobs/9876543', 'handshake', 'user-driven', true],
  ['https://rochester.joinhandshake.com/jobs/123', 'handshake', 'user-driven', true],
  ['https://www.linkedin.com/jobs/view/3912345678/', 'linkedin', 'user-driven', true],
  ['https://www.indeed.com/viewjob?jk=abc', 'indeed', 'user-driven', false],
  ['https://www.glassdoor.com/job-listing/x.htm', 'glassdoor', 'user-driven', false],
  ['https://www.citadel.com/careers/open-opportunities/?gh_jid=555', 'greenhouse-embedded', 'auto-fill-with-approval', false],
  ['https://www.blackstone.com/careers/students/', 'custom-careers', 'read-then-decide', null],
];
for (const [url, ats, route, acct] of cases) {
  const r = d(url);
  assert(r.ok, url + ' should parse');
  assert.strictEqual(r.ats, ats, url + ' -> ' + r.ats + ' (wanted ' + ats + ')');
  assert.strictEqual(r.route, route, url + ' route -> ' + r.route);
  assert.strictEqual(r.requiresAccount, acct, url + ' account -> ' + r.requiresAccount);
  console.log('ok    ' + ats.padEnd(20) + url.slice(0, 70));
}

// tenant + slug extraction
assert.strictEqual(d('https://pjtpartners.wd1.myworkdayjobs.com/Students').tenant, 'pjtpartners');
assert.strictEqual(d('https://job-boards.greenhouse.io/aksia/jobs/4012345').slug, 'aksia');
assert.strictEqual(d('https://job-boards.greenhouse.io/aksia/jobs/4012345').jobId, '4012345');
console.log('ok    tenant / slug / job id extraction');

// redirect unwrapping: aggregator wrapper -> employer ATS
const wrapped = d('https://www.linkedin.com/safety/go?url=' + encodeURIComponent('https://pjtpartners.wd1.myworkdayjobs.com/Students/job/NY/Analyst_R1') + '&trk=x');
assert.strictEqual(wrapped.ats, 'workday');
assert.deepStrictEqual(wrapped.wrappedBy, ['linkedin.com']);
const double = d('https://click.example.com/r?redirect=' + encodeURIComponent('https://app.joinhandshake.com/jobs/1?applyUrl=' + encodeURIComponent('https://jobs.lever.co/acme/1')));
assert.strictEqual(double.ats, 'lever');
assert.strictEqual(double.wrappedBy.length, 2);
console.log('ok    redirect unwrapping (1 and 2 layers)');
assert.strictEqual(unwrap('https://example.com/a?b=c').wrappedBy.length, 0);
assert(!d('not a url').ok, 'garbage input should fail cleanly');
console.log('ok    plain URL untouched, garbage rejected');

// custom sources are picked up (and win over built-ins for their host)
const withCustom = JSON.parse(JSON.stringify(cfg));
withCustom.custom.push({ id: 'simon-portal', label: 'Simon career portal', hosts: ['careers.simon.example.edu'], route: 'user-driven', account: true, notes: 'test' });
const c = d('https://careers.simon.example.edu/jobs/5', withCustom);
assert.strictEqual(c.ats, 'simon-portal');
assert.strictEqual(c.route, 'user-driven');
console.log('ok    custom source (add-source.cjs) is recognized');

// config sanity: the compliance-sensitive sources must stay user-driven, never auto
for (const id of ['handshake', 'linkedin', 'aggregators']) {
  const s = cfg.sources.find((x) => x.id === id);
  assert(s && s.route === 'user-driven', id + ' must be user-driven (site terms prohibit automated access)');
}
for (const h of ['joinhandshake.com', 'linkedin.com']) assert(cfg.redirects.neverFetchHosts.includes(h), h + ' must be in neverFetchHosts');
console.log('ok    Handshake / LinkedIn / aggregators stay user-driven and are never fetched');

// careers-sources.json: every firm has a URL and an ATS that detect-ats agrees with
const careers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'careers-sources.json'), 'utf8'));
assert(careers.companies.length >= 40, 'expected the scanned firms');
for (const co of careers.companies) {
  assert(co.name && co.url, 'firm needs name and url: ' + JSON.stringify(co));
  assert.strictEqual(d(co.url).ats, co.ats, co.name + ' ats mismatch');
}
console.log('ok    careers-sources.json: ' + careers.companies.length + ' firms, ATS matches detect-ats');
console.log('\nAll source tests passed');
