// Tests for scripts/resume-bank.cjs. The real bank is private (git-ignored), so logic tests use a tiny synthetic bank;
// when the real bank is present it is also checked (renders, ids resolve, every variant passes its own fact-check).
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const rb = require('../scripts/resume-bank.cjs');

let n = 0;
const ok = (name, fn) => { try { fn(); n++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } };

const mini = {
  header: { name: 'A B', contact: 'a@b.c' },
  education: [{ school: 'S', place: 'P', degree: 'D', date: '2027', lines: ['L'] }],
  sections: { experience: ['e1'], experiential: ['v1'] },
  employers: {
    e1: { name: 'E1', place: 'X', title: 'Analyst', dates: '2024 – 2025', bullets: [
      { id: 'E-1', text: 'Built an Excel model scoring 29 funds on Sharpe and drawdown, narrowing them to a 5-fund list.', tags: ['excel'] },
      { id: 'E-2', text: 'Evaluated 10+ pre-IPO opportunities with bull and base cases; 3 cleared the committee.', tags: ['valuation'] }] },
    v1: { name: 'Fund', place: 'Y', title: 'Member', dates: '2026 – Present', bullets: [
      { id: 'V-1', text: 'Sourced an AI startup and screened its team, traction and fit.', tags: ['venture'] }] } },
  additional: { certifications: 'Cert', research: 'R 200M+ transactions', interests: 'Guitar' },
  variants: { one: { equirus: [], e1: ['E-1', 'E-2'], v1: ['V-1'], skills: 'Excel, Python (pandas), Bloomberg Terminal' },
              two: { e1: ['E-2', 'E-1'], v1: ['V-1'], skills: 'Python (pandas), R' } },
};
mini.variants.one.bajaj = []; delete mini.variants.one.equirus;

ok('render produces name, bullets and skills line', () => {
  const t = rb.render(mini, 'one');
  assert(t.includes('A B') && t.includes('• Built an Excel model') && t.includes('Skills – Excel, Python (pandas), Bloomberg Terminal'));
});
ok('render rejects an unknown variant', () => assert.throws(() => rb.render(mini, 'nope'), /Unknown variant/));
ok('splitSkills keeps parenthesised commas together', () => {
  assert.deepStrictEqual(rb.splitSkills('A (x, y), B, C (z)'), ['A (x, y)', 'B', 'C (z)']);
});
ok('a rendered variant passes its own fact-check', () => {
  const r = rb.factCheck(mini, rb.render(mini, 'one'));
  assert.deepStrictEqual([r.unknownNumbers, r.unknownSkills, r.unknownBullets], [[], [], []]);
  assert.strictEqual(r.exact.length, 3);
});
ok('reordered bullets still pass', () => {
  const r = rb.factCheck(mini, rb.render(mini, 'two'));
  assert.strictEqual(r.unknownBullets.length + r.unknownNumbers.length + r.unknownSkills.length, 0);
});
ok('a light rewording with the same numbers passes and is reported as reworded', () => {
  const t = rb.render(mini, 'one').replace('Built an Excel model scoring 29 funds on Sharpe and drawdown, narrowing them to a 5-fund list.',
    'Built an Excel model that scores 29 funds on Sharpe and drawdown and narrows them to a 5-fund list.');
  const r = rb.factCheck(mini, t);
  assert.strictEqual(r.reworded.length, 1);
  assert.strictEqual(r.unknownNumbers.length, 0);
});
ok('an invented number is caught', () => {
  const t = rb.render(mini, 'one').replace('29 funds', '40 funds');
  const r = rb.factCheck(mini, t);
  assert(r.unknownNumbers.some((x) => x.startsWith('40')), JSON.stringify(r));
});
ok('an invented skill is caught', () => {
  const t = rb.render(mini, 'one').replace('Bloomberg Terminal', 'Bloomberg Terminal, Tableau');
  assert(rb.factCheck(mini, t).unknownSkills.includes('Tableau'));
});
ok('a brand-new bullet is caught', () => {
  const t = rb.render(mini, 'one') + '\n• Led a team of eight analysts across three offices on a cross-border restructuring mandate.\n';
  assert.strictEqual(rb.factCheck(mini, t).unknownBullets.length, 1);
});
ok('dropping a number is allowed', () => {
  const t = rb.render(mini, 'one').replace('Evaluated 10+ pre-IPO opportunities with bull and base cases; 3 cleared the committee.', 'Evaluated pre-IPO opportunities with bull and base cases; some cleared the committee.');
  const r = rb.factCheck(mini, t);
  assert.strictEqual(r.unknownNumbers.length, 0);
});

const real = path.join(__dirname, '..', 'data', 'resume-bank', 'bank.json');
if (fs.existsSync(real)) {
  const bank = JSON.parse(fs.readFileSync(real, 'utf8'));
  const bl = rb.allBullets(bank);
  ok('real bank: six variants, every bullet id resolves', () => {
    assert.strictEqual(Object.keys(bank.variants).length, 6);
    for (const v of Object.values(bank.variants)) for (const k of ['equirus', 'finfactor', 'bajaj', 'venture']) for (const id of v[k]) assert(bl[id], 'missing ' + id);
  });
  ok('real bank: variant ids match config/search-spec.json', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'search-spec.json'), 'utf8'));
    const ids = Object.keys(spec.resumeVariants).filter((x) => x !== 'base' && !x.startsWith('_')).sort();
    assert.deepStrictEqual(Object.keys(bank.variants).sort(), ids);
  });
  for (const v of Object.keys(bank.variants)) {
    ok('real bank: ' + v + ' renders and passes its own fact-check', () => {
      const r = rb.factCheck(bank, rb.render(bank, v));
      assert.strictEqual(r.unknownNumbers.length + r.unknownSkills.length + r.unknownBullets.length, 0, JSON.stringify(r));
    });
  }
  ok('real bank: an invented figure in the real resume is caught', () => {
    const t = rb.render(bank, 'equity-research').replace('$30M', '$300M');
    assert(rb.factCheck(bank, t).unknownNumbers.length > 0);
  });
} else {
  console.log('skip real-bank checks (data/resume-bank/bank.json not present)');
}

const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
ok('.gitignore keeps the bank and resumes out of the public fork', () => {
  assert(/^data\/resume-bank\/?$/m.test(gi) || /data\/resume-bank/.test(gi), 'data/resume-bank missing');
  assert(/^resumes\/?$/m.test(gi), 'resumes/ missing');
  assert(/profile\.json/.test(gi), 'profile.json missing');
});
console.log(process.exitCode ? 'Some tests FAILED' : 'All resume-bank tests passed (' + n + ')');
