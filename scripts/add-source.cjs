#!/usr/bin/env node
/**
 * Keep adding job sources without touching code.
 *
 *   node scripts/add-source.cjs company "Firm Name" --url https://firm.com/careers [--metro NYC] [--note "text"]
 *       Adds a firm to config/careers-sources.json (ATS auto-detected from the URL).
 *
 *   node scripts/add-source.cjs source --id simon-cmc --label "Simon career portal" --host simon.example.edu \
 *       [--route user-driven|auto-fill-with-approval|read-then-decide] [--account] [--note "text"]
 *       Adds a new kind of source to config/job-sources.json -> custom (detect-ats picks it up straight away).
 *
 *   node scripts/add-source.cjs list
 */
const fs = require('fs');
const path = require('path');
const { detect } = require('./detect-ats.cjs');

const CAREERS = path.join(__dirname, '..', 'config', 'careers-sources.json');
const SOURCES = path.join(__dirname, '..', 'config', 'job-sources.json');
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const cmd = args[0];

if (cmd === 'company') {
  const name = args[1];
  const url = flag('--url');
  if (!name || name.startsWith('--')) { console.error('Usage: add-source.cjs company "Firm Name" --url <careers url> [--metro X] [--note "..."]'); process.exit(1); }
  const db = JSON.parse(fs.readFileSync(CAREERS, 'utf8'));
  const key = norm(name);
  let row = db.companies.find((c) => norm(c.name) === key);
  const d = url ? detect(url) : null;
  if (!row) { row = { name }; db.companies.push(row); }
  if (url) { row.url = url; row.ats = d && d.ok ? d.ats : 'unknown'; if (d && d.tenant) row.tenant = d.tenant; }
  if (flag('--metro')) row.metro = flag('--metro');
  if (flag('--note')) row.note = flag('--note');
  row.added = row.added || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(CAREERS, JSON.stringify(db, null, 2) + '\n');
  console.log('Saved ' + name + (url ? '  ->  ' + row.ats : '') + '   (' + db.companies.length + ' firms in careers-sources.json)');
} else if (cmd === 'source') {
  const id = flag('--id'); const host = flag('--host');
  if (!id || !host) { console.error('Usage: add-source.cjs source --id <id> --label "<name>" --host <domain> [--route ...] [--account] [--note "..."]'); process.exit(1); }
  const route = flag('--route') || 'read-then-decide';
  if (!['user-driven', 'auto-fill-with-approval', 'read-then-decide'].includes(route)) { console.error('Unknown route: ' + route); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
  cfg.custom = (cfg.custom || []).filter((c) => c.id !== id);
  cfg.custom.push({ id, label: flag('--label') || id, hosts: [host.replace(/^https?:\/\//, '').replace(/\/.*$/, '')], route, account: args.includes('--account'), notes: flag('--note') || '' });
  fs.writeFileSync(SOURCES, JSON.stringify(cfg, null, 2) + '\n');
  console.log('Saved custom source "' + id + '" (' + route + '). Test it: node scripts/detect-ats.cjs https://' + host + '/');
} else if (cmd === 'list') {
  const db = JSON.parse(fs.readFileSync(CAREERS, 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
  console.log('Built-in sources: ' + cfg.sources.map((s) => s.id).join(', '));
  console.log('Custom sources:   ' + ((cfg.custom || []).map((s) => s.id).join(', ') || '(none)'));
  const by = {}; db.companies.forEach((c) => { by[c.ats || 'unknown'] = (by[c.ats || 'unknown'] || 0) + 1; });
  console.log('Firms with careers URLs: ' + db.companies.length + '  ' + JSON.stringify(by));
} else {
  console.error('Commands: company | source | list   (see the header of this file)');
  process.exit(1);
}
