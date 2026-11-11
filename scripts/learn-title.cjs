#!/usr/bin/env node
/**
 * Remember which resume variant a job title should use, so the next posting with the same title
 * is routed without re-researching it.
 *
 *   node scripts/learn-title.cjs "Credit Portfolio Analyst" alternatives-manager-dd --note "reads like private credit monitoring"
 *   node scripts/learn-title.cjs --list
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'config', 'role-title-map.json');
const norm = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9&/+' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const args = process.argv.slice(2);
const map = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (args.includes('--list') || args.length === 0) {
  const keys = Object.keys(map.learned);
  console.log(keys.length ? keys.map((k) => '  ' + k + '  ->  ' + map.learned[k]).join('\n') : '(nothing learned yet)');
  console.log('\nVariants: ' + map.variants.join(', '));
  process.exit(0);
}
const [title, variant] = args;
if (!title || !variant) { console.error('Usage: node scripts/learn-title.cjs "<job title>" <variant-id> [--note "why"]'); process.exit(1); }
if (!map.variants.includes(variant)) { console.error('Unknown variant "' + variant + '". Choose one of: ' + map.variants.join(', ')); process.exit(1); }
const ni = args.indexOf('--note');
map.learned[norm(title)] = variant;
if (ni !== -1 && args[ni + 1]) map.notes[norm(title)] = args[ni + 1];
fs.writeFileSync(FILE, JSON.stringify(map, null, 2) + '\n');
console.log('Saved: "' + norm(title) + '" -> ' + variant);
