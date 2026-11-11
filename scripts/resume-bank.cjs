#!/usr/bin/env node
/**
 * The resume bank: every true bullet from the six final resumes (data/resume-bank/bank.json, git-ignored).
 *
 *   node scripts/resume-bank.cjs list
 *   node scripts/resume-bank.cjs render <variant> [--out file.txt]
 *   node scripts/resume-bank.cjs verify                      # bank is internally consistent
 *   node scripts/resume-bank.cjs facts <tailored.txt> [--bank path]   # fact-check a tailored resume against the bank
 *   node scripts/resume-bank.cjs find <theme> [<theme> ...]  # bullets carrying these theme tags
 *
 * `facts` fails (exit 1) when a tailored resume contains a number, skill/tool, or bullet that cannot be traced to the bank.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_BANK = path.join(__dirname, '..', 'data', 'resume-bank', 'bank.json');

function loadBank(p) {
  const file = p || DEFAULT_BANK;
  if (!fs.existsSync(file)) {
    console.error('Missing ' + file + '. The resume bank is a private file; it is delivered separately from the public repo.');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const norm = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

function allBullets(bank) {
  const out = {};
  for (const [emp, e] of Object.entries(bank.employers)) for (const b of e.bullets) out[b.id] = { ...b, employer: emp };
  return out;
}

/** Plain-text layout matching Final_Resumes_Text. */
function render(bank, variant) {
  const v = bank.variants[variant];
  if (!v) throw new Error('Unknown variant: ' + variant + '. Choose one of: ' + Object.keys(bank.variants).join(', '));
  const bl = allBullets(bank);
  const L = [];
  L.push('   ' + bank.header.name, '   ' + bank.header.contact, 'EDUCATION');
  bank.education.forEach((ed, i) => {
    L.push(ed.school + '   ' + ed.place, ed.degree + '   ' + ed.date, ...ed.lines);
    if (i < bank.education.length - 1) L.push('');
  });
  const block = (key, heading) => {
    L.push('', heading);
    for (const emp of bank.sections[key]) {
      const e = bank.employers[emp];
      L.push(e.name + '   ' + e.place, e.title + '   ' + e.dates);
      for (const id of v[emp]) L.push('• ' + bl[id].text);
      if (emp !== bank.sections[key][bank.sections[key].length - 1]) L.push('');
    }
  };
  block('experience', 'PROFESSIONAL EXPERIENCE');
  block('experiential', 'EXPERIENTIAL LEARNING');
  L.push('', 'ADDITIONAL INFORMATION', '• Certifications - ' + bank.additional.certifications, '• Skills – ' + v.skills,
    '• Research - ' + bank.additional.research, '• Interests - ' + bank.additional.interests);
  return L.join('\n') + '\n';
}

/** Split a comma list, ignoring commas inside parentheses. */
function splitSkills(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?(?:\s?[–-]\s?\$?\d[\d,]*(?:\.\d+)?)?[%+KMBx]*\+?/g;
function numbersIn(text) {
  return new Set((String(text).replace(/[‘’]/g, "'").match(NUM_RE) || []).map((n) => n.replace(/\s+/g, '').replace(/[.,]$/, '')));
}

function bankNumbers(bank) {
  let all = JSON.stringify(bank.header) + JSON.stringify(bank.education) + JSON.stringify(bank.additional);
  for (const e of Object.values(bank.employers)) {
    all += ' ' + e.dates + ' ' + e.title;
    for (const b of e.bullets) all += ' ' + b.text;
  }
  return numbersIn(all);
}

function allowedSkills(bank) {
  const set = new Map();
  for (const v of Object.values(bank.variants)) splitSkills(v.skills).forEach((s) => set.set(norm(s), s));
  return set;
}

function tokens(s) { return new Set(norm(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 3)); }
function overlap(a, b) { let n = 0; for (const t of a) if (b.has(t)) n++; return n / Math.max(1, Math.min(a.size, b.size)); }

/** Compare a tailored resume (plain text) to the bank. */
function factCheck(bank, text) {
  const bl = allBullets(bank);
  const byNorm = new Map(Object.values(bl).map((b) => [norm(b.text), b]));
  const lines = text.split(/\r?\n/);
  // join wrapped bullet lines: continuation = indented line that follows a bullet
  const joined = [];
  for (const ln of lines) {
    if (/^\s{2,}\S/.test(ln) && joined.length && /^•/.test(joined[joined.length - 1].trim())) joined[joined.length - 1] += ' ' + ln.trim();
    else joined.push(ln);
  }
  const res = { exact: [], reworded: [], unknownNumbers: [], unknownSkills: [], unknownBullets: [] };
  const known = bankNumbers(bank);
  const knownFlat = new Set([...known].map((n) => n.replace(/[$,]/g, '')));
  for (const ln of joined) {
    const t = ln.trim();
    if (!/^•/.test(t)) continue;
    const body = t.replace(/^•\s*/, '');
    if (/^(Certifications|Research|Interests)\s*[-–]/i.test(body)) continue;
    if (/^Skills\s*[-–]/i.test(body)) {
      const skills = splitSkills(body.replace(/^Skills\s*[-–]\s*/i, ''));
      const ok = allowedSkills(bank);
      for (const s of skills) if (!ok.has(norm(s))) res.unknownSkills.push(s);
      continue;
    }
    const hit = byNorm.get(norm(body));
    if (hit) { res.exact.push(hit.id); continue; }
    // reworded: find the closest bank bullet and compare numbers
    let best = null; let bestScore = 0;
    for (const b of Object.values(bl)) { const sc = overlap(tokens(body), tokens(b.text)); if (sc > bestScore) { bestScore = sc; best = b; } }
    if (!best || bestScore < 0.45) { res.unknownBullets.push(body.slice(0, 90)); continue; }
    res.reworded.push({ closest: best.id, similarity: Math.round(bestScore * 100) + '%', text: body });
    for (const n of numbersIn(body)) {
      if (!known.has(n) && !knownFlat.has(n.replace(/[$,]/g, ''))) res.unknownNumbers.push(n + '   (in: "' + body.slice(0, 60) + '...")');
    }
    const bn = numbersIn(best.text);
    for (const n of bn) if (!numbersIn(body).has(n)) { /* dropping a number is fine */ }
  }
  return res;
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const bi = args.indexOf('--bank');
  const bank = loadBank(bi !== -1 ? args[bi + 1] : null);
  if (cmd === 'list') {
    const bl = allBullets(bank);
    console.log(Object.keys(bl).length + ' bullets in the bank');
    for (const [id, v] of Object.entries(bank.variants)) {
      const n = ['equirus', 'finfactor', 'bajaj', 'venture'].reduce((a, k) => a + v[k].length, 0);
      console.log('  ' + id.padEnd(34) + n + ' bullets');
    }
  } else if (cmd === 'render') {
    const out = render(bank, args[1]);
    const oi = args.indexOf('--out');
    if (oi !== -1) { fs.writeFileSync(args[oi + 1], out); console.log('Wrote ' + args[oi + 1]); } else process.stdout.write(out);
  } else if (cmd === 'verify') {
    const bl = allBullets(bank); const problems = [];
    for (const [vid, v] of Object.entries(bank.variants)) {
      for (const k of ['equirus', 'finfactor', 'bajaj', 'venture']) for (const id of v[k]) if (!bl[id]) problems.push(vid + ': unknown bullet ' + id);
      if (!v.skills) problems.push(vid + ': no skills line');
    }
    console.log(problems.length ? problems.join('\n') : 'bank OK (' + Object.keys(bl).length + ' bullets, ' + Object.keys(bank.variants).length + ' variants)');
    process.exit(problems.length ? 1 : 0);
  } else if (cmd === 'find') {
    const want = args.slice(1).filter((a) => !a.startsWith('--'));
    for (const b of Object.values(allBullets(bank))) {
      const m = want.filter((t) => (b.tags || []).includes(t));
      if (m.length) console.log('[' + b.id + '] (' + m.join(', ') + ') ' + b.text);
    }
  } else if (cmd === 'facts') {
    const file = args[1];
    if (!file || !fs.existsSync(file)) { console.error('Usage: resume-bank.cjs facts <tailored.txt>'); process.exit(1); }
    const r = factCheck(bank, fs.readFileSync(file, 'utf8'));
    console.log('Bullets identical to the bank: ' + r.exact.length);
    console.log('Bullets reworded:              ' + r.reworded.length);
    r.reworded.forEach((x) => console.log('   reworded from ' + x.closest + ' (' + x.similarity + ' similar): ' + x.text.slice(0, 110)));
    let bad = 0;
    const show = (title, arr) => { if (arr.length) { bad += arr.length; console.log('\nFAIL - ' + title + ':'); arr.forEach((a) => console.log('   ' + a)); } };
    show('numbers that are not in the bank (confirm with the user, add to the bank, or remove)', r.unknownNumbers);
    show('skills / tools not in the bank (the user must confirm they have them)', r.unknownSkills);
    show('bullets that match nothing in the bank (new facts need the user first)', r.unknownBullets);
    console.log(bad ? '\n' + bad + ' problem(s). Do not use this resume yet.' : '\nAll numbers, tools and bullets trace to the bank.');
    process.exit(bad ? 1 : 0);
  } else {
    console.error('Commands: list | render <variant> | verify | find <theme> | facts <file>');
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { render, factCheck, splitSkills, allBullets, numbersIn, allowedSkills };
