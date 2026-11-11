#!/usr/bin/env node
/**
 * Check which slugs in config/greenhouse-companies.json are live Greenhouse boards.
 *
 *   node scripts/verify-slugs.cjs            # report only
 *   node scripts/verify-slugs.cjs --apply    # remove dead slugs and mark the rest 'verified'
 *
 * Needs internet access to boards-api.greenhouse.io (run it on your own machine).
 * Only reads the public job-board API; one request per slug, a few at a time.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config', 'greenhouse-companies.json');
const APPLY = process.argv.includes('--apply');

function check(slug) {
  return new Promise((resolve) => {
    const req = https.get({ host: 'boards-api.greenhouse.io', path: '/v1/boards/' + encodeURIComponent(slug) + '/jobs', headers: { 'User-Agent': 'job-apply-ai slug check' }, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve({ slug, live: true, jobs: (JSON.parse(body).jobs || []).length }); } catch (e) { resolve({ slug, live: false, why: 'bad JSON' }); }
        } else resolve({ slug, live: false, why: 'HTTP ' + res.statusCode });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ slug, live: false, why: 'timeout', network: true }); });
    req.on('error', (e) => resolve({ slug, live: false, why: e.code || e.message, network: true }));
  });
}

(async () => {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const slugs = doc.companies || [];
  const results = [];
  for (let i = 0; i < slugs.length; i += 5) results.push(...(await Promise.all(slugs.slice(i, i + 5).map(check))));
  const netFail = results.filter((r) => r.network).length;
  if (netFail > results.length / 2) {
    console.error('Most requests failed (' + netFail + '/' + results.length + '): no internet or boards-api.greenhouse.io is blocked. Nothing changed.');
    process.exit(2);
  }
  const live = results.filter((r) => r.live); const dead = results.filter((r) => !r.live);
  live.forEach((r) => console.log('live  ' + r.slug.padEnd(34) + r.jobs + ' open jobs'));
  dead.forEach((r) => console.log('dead  ' + r.slug.padEnd(34) + r.why));
  console.log('\n' + live.length + ' live, ' + dead.length + ' not found, of ' + results.length);
  if (APPLY) {
    const liveSet = new Set(live.map((r) => r.slug));
    doc.companies = slugs.filter((s) => liveSet.has(s));
    doc.details = (doc.details || []).filter((d) => liveSet.has(d.slug)).map((d) => ({ ...d, status: 'verified' }));
    doc._total = doc.companies.length;
    doc._updated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
    console.log('Updated ' + path.relative(process.cwd(), FILE) + ' (' + doc.companies.length + ' verified slugs).');
  } else if (dead.length) console.log('Run again with --apply to remove the dead ones.');
})();
