// tests/linkedin-referrals.test.mjs — the LinkedIn warm-channel match engine.
// Pure-logic tests: they pass explicit `active` and `existing` sets so nothing
// touches the user's real applications.md / referrals.md. Every company, role
// and person below is invented — no real pipeline value appears in this file.
import assert from 'node:assert';
import { parseConnectionsCsv, matchConnections, stageForRow } from '../dashboard-web/server/lib/linkedin-referrals.mjs';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n       ${e.message}`); fail++; } };

console.log('1. parseConnectionsCsv skips the preamble and handles quoted fields');
const CSV = `Notes:,,,,,,
"When exporting your connection data, some emails may be missing.",,,,,,
,,,,,,
First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ada,Lovelace,https://linkedin.com/in/ada,ada@example.com,Zephyr Labs,"Director, Widget Operations",31 Jul 2026
Alan,Turing,https://linkedin.com/in/alan,,Acme Rockets,Senior Sales Engineer,20 Apr 2026
`;
const conns = parseConnectionsCsv(CSV);
ok('parses 2 connection rows (preamble + header skipped)', () => assert.equal(conns.length, 2));
ok('maps columns correctly', () => {
  assert.equal(conns[0].first, 'Ada');
  assert.equal(conns[0].company, 'Zephyr Labs');
  assert.equal(conns[0].position, 'Director, Widget Operations'); // comma inside quotes preserved
  assert.equal(conns[0].url, 'https://linkedin.com/in/ada');
});
ok('returns [] when there is no header row', () => assert.deepEqual(parseConnectionsCsv('garbage,no,header\n1,2,3'), []));

console.log('\n2. matchConnections splits Stage 1 (inside a target) from Stage 2 (referrer pool)');
const active = [{ company: 'Zephyr Labs', role: 'VP of Widget Analytics' }];
const empty = { names: new Set(), urls: new Set() };
const sample = [
  { first: 'Ada', last: 'Lovelace', company: 'Zephyr Labs', position: 'Director, RevOps', url: 'u1' },        // Stage 1: inside target
  { first: 'Grace', last: 'Hopper', company: 'Globex', position: 'Chief Revenue Officer', url: 'u2' },         // Stage 2: senior in-function
  { first: 'Alan', last: 'Turing', company: 'Acme', position: 'Senior Software Engineer', url: 'u3' },         // neither (not in-function)
  { first: 'Kurt', last: 'Godel', company: 'Vienna', position: 'Director of Technical Operations', url: 'u4' }, // NOT stage 2: bare ops, not GTM
];
const m = matchConnections({ connections: sample, active, existing: empty });
ok('Stage 1 = connection inside an active company', () => {
  assert.equal(m.stage1.length, 1);
  assert.equal(m.stage1[0].first, 'Ada');
  assert.equal(m.stage1[0].target.role, 'VP of Widget Analytics');
});
ok('Stage 2 = senior GTM referrer not at a target', () => {
  assert.equal(m.stage2.length, 1);
  assert.equal(m.stage2[0].first, 'Grace');
});
ok('a plain IC is neither stage', () => {
  assert.ok(!m.stage1.some(c => c.first === 'Alan') && !m.stage2.some(c => c.first === 'Alan'));
});
ok('bare "operations" (non-GTM) is NOT a Stage-2 referrer', () => {
  assert.ok(!m.stage2.some(c => c.first === 'Kurt'));
});
ok('"Zephyr Labs" matches "Zephyr" too (trailing-generic form)', () => {
  const r = matchConnections({ connections: [{ first: 'X', last: 'Y', company: 'Zephyr', position: 'RevOps Lead', url: 'u' }], active, existing: empty });
  assert.equal(r.stage1.length, 1);
});
ok('dedup: a connection already in `existing` (by url) is skipped', () => {
  const r = matchConnections({ connections: [sample[0]], active, existing: { names: new Set(), urls: new Set(['u1']) } });
  assert.equal(r.stage1.length, 0);
});

console.log('\n3. stageForRow derives stage live from pipeline membership');
const activeSet = new Set(['zephyrlabs', 'zephyr']);
ok('LinkedIn row inside an active company → stage1', () =>
  assert.equal(stageForRow({ how: '1st-degree LinkedIn connection', where: 'Zephyr Labs' }, activeSet), 'stage1'));
ok('LinkedIn row NOT at an active company → stage2', () =>
  assert.equal(stageForRow({ how: '1st-degree LinkedIn connection', where: 'Globex' }, activeSet), 'stage2'));
ok('manually-added row (no LinkedIn) → other', () =>
  assert.equal(stageForRow({ how: 'Worked together at Acme 2015-2019', where: 'Acme' }, activeSet), 'other'));

console.log(`\n${fail === 0 ? '🟢' : '🔴'} linkedin-referrals: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
