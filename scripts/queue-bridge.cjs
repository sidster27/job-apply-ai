#!/usr/bin/env node
/**
 * Bridge for scripts/build-apply-queue.py: reuse the Node routing and resume-variant logic instead of
 * re-implementing it in Python.
 *
 * stdin : JSON array of { id, url, ats_hint, title, text }
 * stdout: JSON array of { id, ats, label, route, requiresAccount, variant }
 *
 * - route/ats come from scripts/detect-ats.cjs detect() on the Careers Link (config/job-sources.json).
 *   When the link is only a firm careers page, ats_hint (Careers Sources "System / Type") names the ATS.
 * - variant comes from scripts/greenhouse-filter.cjs pickVariant() (config/role-title-map.json learned
 *   titles first, then config/search-spec.json resumeVariants), with sectors read from `text`.
 */
const { detect } = require('./detect-ats.cjs');
const { pickVariant, loadSpec, hits } = require('./greenhouse-filter.cjs');

const HINTS = [
  [/workday|myworkday/i, { ats: 'workday', label: 'Workday', route: 'auto-fill-with-approval', requiresAccount: true }],
  [/greenhouse/i, { ats: 'greenhouse', label: 'Greenhouse', route: 'auto-fill-with-approval', requiresAccount: false }],
  [/oracle/i, { ats: 'oracle-cloud', label: 'Oracle Cloud Recruiting', route: 'auto-fill-with-approval', requiresAccount: true }],
  [/tal\.net|taleo/i, { ats: 'talnet', label: 'Tal.net / Taleo', route: 'auto-fill-with-approval', requiresAccount: true }],
  [/icims/i, { ats: 'icims', label: 'iCIMS', route: 'auto-fill-with-approval', requiresAccount: true }],
  [/lever/i, { ats: 'lever', label: 'Lever', route: 'auto-fill-with-approval', requiresAccount: false }],
  [/successfactors/i, { ats: 'successfactors', label: 'SAP SuccessFactors', route: 'auto-fill-with-approval', requiresAccount: true }],
  [/handshake/i, { ats: 'handshake', label: 'Handshake', route: 'user-driven', requiresAccount: true }],
  [/linkedin/i, { ats: 'linkedin', label: 'LinkedIn', route: 'user-driven', requiresAccount: true }],
];

function route(url, hint) {
  const d = url ? detect(url) : { ok: false };
  if (d.ok && d.ats !== 'custom-careers') {
    return { ats: d.ats, label: d.label, route: d.route, requiresAccount: d.requiresAccount };
  }
  for (const [re, r] of HINTS) if (hint && re.test(hint)) return { ...r, label: r.label + ' (from Careers Sources)' };
  return { ats: 'custom-careers', label: 'Firm careers site (ATS unknown until Apply is opened)', route: 'read-then-decide', requiresAccount: null };
}

function main() {
  const spec = loadSpec(require('path').join(__dirname, '..', 'config', 'search-spec.json'));
  const items = JSON.parse(require('fs').readFileSync(0, 'utf8') || '[]');
  const out = items.map((it) => {
    const sectorsHit = Object.keys(spec.sectors || {})
      .filter((k) => !k.startsWith('_'))
      .filter((k) => hits(String(it.text || ''), spec.sectors[k]).length > 0);
    return { id: it.id, ...route(it.url, it.ats_hint), variant: pickVariant(String(it.title || ''), sectorsHit, spec) };
  });
  process.stdout.write(JSON.stringify(out));
}

if (require.main === module) main();
module.exports = { route };
