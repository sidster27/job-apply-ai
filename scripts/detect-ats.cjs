#!/usr/bin/env node
/**
 * Work out what a job link really is: which ATS / source, whether it needs an account, and how it
 * may be handled (auto-fill with approval vs user-driven). Unwraps aggregator / tracking links.
 *
 *   node scripts/detect-ats.cjs "<url>"            # pure URL analysis, no network
 *   node scripts/detect-ats.cjs "<url>" --follow   # also follow plain HTTP redirects (never on Handshake/LinkedIn/Indeed/Glassdoor)
 *   node scripts/detect-ats.cjs --json "<url>"
 *
 * Custom sources added with scripts/add-source.cjs (config/job-sources.json -> custom) are checked first.
 */
const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'config', 'job-sources.json');
function loadSources() {
  try { return JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')); } catch (e) { return { custom: [], redirects: {} }; }
}

const AUTO = 'auto-fill-with-approval';
const USER = 'user-driven';
const READ = 'read-then-decide';

// id, label, host test, route, requiresAccount, notes
const RULES = [
  { id: 'handshake', label: 'Handshake', test: (h) => /(^|\.)joinhandshake\.(com|co\.uk)$/.test(h), route: USER, account: true,
    notes: 'Terms prohibit automated crawling. User browses; Claude reads only the open page. If Apply leaves Handshake, route by the destination.' },
  { id: 'linkedin', label: 'LinkedIn', test: (h) => /(^|\.)linkedin\.com$/.test(h), route: USER, account: true,
    notes: 'No automated collection. Find the employer posting and apply on the employer site where possible.' },
  { id: 'indeed', label: 'Indeed', test: (h) => /(^|\.)indeed\.com$/.test(h), route: USER, account: false, notes: 'Aggregator: find the employer posting.' },
  { id: 'glassdoor', label: 'Glassdoor', test: (h) => /(^|\.)glassdoor\.com$/.test(h), route: USER, account: false, notes: 'Aggregator: find the employer posting.' },
  { id: 'ziprecruiter', label: 'ZipRecruiter', test: (h) => /(^|\.)ziprecruiter\.com$/.test(h), route: USER, account: false, notes: 'Aggregator: find the employer posting.' },
  { id: 'greenhouse', label: 'Greenhouse', test: (h) => /(^|\.)(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(h) || h === 'boards-api.greenhouse.io', route: AUTO, account: false,
    notes: 'Standard Greenhouse form. The email security code step needs the user.' },
  { id: 'lever', label: 'Lever', test: (h) => h === 'jobs.lever.co' || h === 'jobs.eu.lever.co', route: AUTO, account: false, notes: 'Standard Lever form; may show hCaptcha (user handles it).' },
  { id: 'ashby', label: 'Ashby', test: (h) => h === 'jobs.ashbyhq.com', route: AUTO, account: false, notes: 'Standard Ashby form.' },
  { id: 'workday', label: 'Workday', test: (h) => /\.wd\d+\.myworkday(jobs|site)\.com$/.test(h) || /(^|\.)myworkdayjobs\.com$/.test(h), route: AUTO, account: true,
    notes: 'One account per tenant. User creates / signs in and handles verification and CAPTCHA. See docs/workday-ats-guide.md.',
    tenant: (u) => u.hostname.split('.')[0] },
  { id: 'smartrecruiters', label: 'SmartRecruiters', test: (h) => /(^|\.)smartrecruiters\.com$/.test(h), route: AUTO, account: false, notes: 'Standard form.' },
  { id: 'workable', label: 'Workable', test: (h) => h === 'apply.workable.com' || /\.workable\.com$/.test(h), route: AUTO, account: false, notes: 'Standard form.' },
  { id: 'jobvite', label: 'Jobvite', test: (h) => /(^|\.)jobvite\.com$/.test(h), route: AUTO, account: false, notes: 'Standard form.' },
  { id: 'icims', label: 'iCIMS', test: (h) => /(^|\.)icims\.com$/.test(h), route: AUTO, account: true, notes: 'Usually needs an account; long multi-page form.' },
  { id: 'oracle-cloud', label: 'Oracle Cloud Recruiting', test: (h) => /(^|\.)oraclecloud\.com$/.test(h), route: AUTO, account: true,
    notes: 'JavaScript-heavy; may not be readable automatically. Open it in the browser and continue user-driven if it will not load.' },
  { id: 'taleo', label: 'Oracle Taleo', test: (h) => /(^|\.)taleo\.net$/.test(h), route: AUTO, account: true, notes: 'Account required; old multi-step form.' },
  { id: 'successfactors', label: 'SAP SuccessFactors', test: (h) => /(^|\.)successfactors\.(com|eu)$/.test(h) || /(^|\.)sapsf\.(com|eu)$/.test(h), route: AUTO, account: true, notes: 'Account required.' },
  { id: 'talnet', label: 'Tal.net (Oleeo)', test: (h) => /(^|\.)tal\.net$/.test(h), route: AUTO, account: true, notes: 'Account required; common for banks (e.g. Jefferies).' },
  { id: 'eightfold', label: 'Eightfold', test: (h) => /(^|\.)eightfold\.ai$/.test(h), route: AUTO, account: false, notes: 'JavaScript board; may need the browser.' },
  { id: 'jazzhr', label: 'JazzHR', test: (h) => /(^|\.)applytojob\.com$/.test(h), route: AUTO, account: false, notes: 'Standard form; may show a reCAPTCHA (user ticks it).' },
  { id: 'bamboohr', label: 'BambooHR', test: (h) => /(^|\.)bamboohr\.com$/.test(h), route: AUTO, account: false, notes: 'Standard form.' },
  { id: 'ukg', label: 'UKG / UltiPro', test: (h) => /(^|\.)ultipro\.com$/.test(h) || /(^|\.)ukg\.com$/.test(h), route: AUTO, account: true, notes: 'Account likely.' },
  { id: 'adp', label: 'ADP', test: (h) => /(^|\.)adp\.com$/.test(h), route: AUTO, account: true, notes: 'Account likely.' },
  { id: 'hirevue', label: 'HireVue', test: (h) => /(^|\.)hirevue\.com$/.test(h), route: USER, account: false,
    notes: 'Video / assessment platform, not a normal form: the user completes it personally.' },
];

function safeUrl(s) { try { return new URL(s); } catch (e) { return null; } }

/** Peel aggregator / tracking wrappers: ...?url=https%3A%2F%2Fjobs.example.com%2F123. Returns { url, wrappedBy[] }. */
function unwrap(input, wrapperParams) {
  const params = (wrapperParams || ['url', 'u', 'redirect', 'redirect_url', 'redirecturl', 'dest', 'destination', 'target', 'externalapplyurl', 'applyurl', 'link']).map((p) => p.toLowerCase());
  const wrappedBy = [];
  let cur = safeUrl(input);
  for (let i = 0; cur && i < 4; i++) {
    let inner = null;
    for (const [k, v] of cur.searchParams.entries()) {
      if (!params.includes(k.toLowerCase())) continue;
      const cand = safeUrl(decodeURIComponent(v));
      if (cand && /^https?:$/.test(cand.protocol)) { inner = cand; break; }
    }
    if (!inner) break;
    wrappedBy.push(cur.hostname.replace(/^www\./, ''));
    cur = inner;
  }
  return { url: cur, wrappedBy };
}

/** Pure URL analysis (no network). */
function detect(input, sourcesCfg) {
  const cfg = sourcesCfg || loadSources();
  const un = unwrap(input, (cfg.redirects || {}).wrapperParams);
  const u = un.url;
  if (!u) return { input, ok: false, error: 'not a valid http(s) URL' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const base = { input, final: u.toString(), host, wrappedBy: un.wrappedBy };

  for (const c of cfg.custom || []) {
    if ((c.hosts || []).some((h) => host === h || host.endsWith('.' + h))) {
      return { ...base, ok: true, ats: c.id, label: c.label, route: c.route || READ, requiresAccount: !!c.account, notes: c.notes || 'Custom source.' };
    }
  }
  for (const r of RULES) {
    if (r.test(host)) {
      const out = { ...base, ok: true, ats: r.id, label: r.label, route: r.route, requiresAccount: r.account, notes: r.notes };
      if (r.tenant) out.tenant = r.tenant(u);
      if (r.id === 'greenhouse') {
        const m = u.pathname.match(/^\/([^/]+)(?:\/jobs\/(\d+))?/);
        if (m) { out.slug = m[1] === 'embed' ? u.searchParams.get('for') || null : m[1]; if (m[2]) out.jobId = m[2]; }
      }
      return out;
    }
  }
  // A firm's own site that embeds a Greenhouse form: ?gh_jid=123
  if (u.searchParams.has('gh_jid')) {
    return { ...base, ok: true, ats: 'greenhouse-embedded', label: 'Greenhouse (embedded on the firm site)', route: AUTO, requiresAccount: false,
      jobId: u.searchParams.get('gh_jid'), notes: 'The form is a Greenhouse iframe inside the firm page. Open the page; the iframe URL names the board slug.' };
  }
  const careersish = /career|jobs|recruit|talent|join|apply|opportunit/.test(host + u.pathname);
  return { ...base, ok: true, ats: 'custom-careers', label: careersish ? 'Firm careers site (unrecognized ATS)' : 'Unrecognized site', route: READ, requiresAccount: null,
    notes: 'Open the posting, click Apply, and run detect-ats on where it lands. If it only returns to the careers home page it is a search page, not an application.' };
}

/** Follow ordinary HTTP redirects (network). Never touches aggregator hosts. */
async function follow(url, cfg) {
  const never = ((cfg || loadSources()).redirects || {}).neverFetchHosts || [];
  const max = ((cfg || loadSources()).redirects || {}).followRedirectsMax || 8;
  const hops = [];
  let cur = url;
  for (let i = 0; i < max; i++) {
    const u = safeUrl(cur);
    if (!u) break;
    const host = u.hostname.toLowerCase();
    if (never.some((h) => host === h || host.endsWith('.' + h))) { hops.push({ url: cur, note: 'not fetched (site terms prohibit automated access); open it yourself' }); break; }
    let res;
    try { res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }); }
    catch (e) { hops.push({ url: cur, note: 'fetch failed: ' + e.message }); break; }
    hops.push({ url: cur, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
    break;
  }
  return { hops, final: cur };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const doFollow = args.includes('--follow');
  const url = args.find((a) => !a.startsWith('--'));
  if (!url) { console.error('Usage: node scripts/detect-ats.cjs "<job url>" [--follow] [--json]'); process.exit(1); }
  const cfg = loadSources();
  let target = url;
  let hops = null;
  const first = detect(url, cfg);
  if (doFollow && first.ok && !['handshake', 'linkedin', 'indeed', 'glassdoor', 'ziprecruiter'].includes(first.ats)) {
    const f = await follow(first.final, cfg);
    hops = f.hops; target = f.final;
  }
  const res = detect(target, cfg);
  if (hops) res.redirectHops = hops;
  if (res.ok && target !== url && res.final !== first.final) res.followedFrom = first.final;
  if (asJson) { console.log(JSON.stringify(res, null, 2)); return; }
  if (!res.ok) { console.log('Could not read that URL: ' + res.error); return; }
  console.log('Source:   ' + res.label + '  (' + res.ats + ')');
  console.log('Host:     ' + res.host + (res.tenant ? '   tenant: ' + res.tenant : ''));
  console.log('Route:    ' + res.route);
  console.log('Account:  ' + (res.requiresAccount === null ? 'unknown' : res.requiresAccount ? 'yes (you create / sign in; never share the password)' : 'no'));
  if (res.wrappedBy.length) console.log('Unwrapped from: ' + res.wrappedBy.join(' -> '));
  if (res.followedFrom) console.log('Redirected from: ' + res.followedFrom);
  console.log('Notes:    ' + res.notes);
}

if (require.main === module) main();
module.exports = { detect, unwrap, follow, RULES };
