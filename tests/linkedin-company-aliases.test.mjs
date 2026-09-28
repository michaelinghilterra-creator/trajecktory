// Company forms and the user alias file behind the LinkedIn referral match. Every name is invented.
import assert from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const dir = makeSandbox('aliases');
writeFileSync(join(dir, 'company-aliases.json'), JSON.stringify({ groups: [
  ['Quillfeather Storage', 'Evermoor'],
  ['Brambleton Health', 'Brambleton', 'Brambleton Therapy Solutions Inc'],
] }));
process.env.TJK_DATA_DIR = dir;
const { companyForms, matchConnections, stageForRow } = await import('../dashboard-web/server/lib/linkedin-referrals.mjs');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const has = (c, f) => companyForms(c).includes(f);

check('trailing Group is stripped', () => assert.ok(has('Zorblax Group', 'zorblax')));
check('trailing Corporation is stripped', () => assert.ok(has('Pellwick Holdings Corporation', 'pellwickholdings')));
check('trailing parenthetical is dropped and the former name is not kept', () => {
  assert.ok(has('Tessaline (formerly Glimmerco)', 'tessaline'));
  assert.ok(!has('Tessaline (formerly Glimmerco)', 'glimmerco'));
});
check('domain suffix is stripped', () => assert.ok(has('Hopvale.ai', 'hopvale')));
check('"A / B" yields both sides', () => {
  assert.ok(has('Nimbrel / Castorway', 'nimbrel'));
  assert.ok(has('Nimbrel / Castorway', 'castorway'));
});
check('only one generic suffix layer is stripped', () => {
  assert.ok(has('Crandle Software, LLC', 'crandlesoftware'));
  assert.ok(!has('Crandle Software, LLC', 'crandle'));
});
check('a non-generic word is kept', () => assert.ok(!has('Vexmoor Security', 'vexmoor')));
check('alias matches in both directions', () => {
  assert.ok(has('Evermoor', 'quillfeatherstorage'));
  assert.ok(has('Quillfeather Storage', 'evermoor'));
});
check('a three-name alias group links every member', () => assert.ok(has('Brambleton Therapy Solutions Inc', 'brambletonhealth')));
check('alias groups stay separate', () => assert.ok(!has('Evermoor', 'brambletonhealth')));
check('a company with no alias is unaffected', () => assert.deepEqual(companyForms('Zorblax'), ['zorblax']));
check('a connection at the new name matches the tracker company', () => {
  const r = matchConnections({
    connections: [{ first: 'Ada', last: 'Vance', company: 'Evermoor', position: 'Senior Recruiter', url: 'https://www.linkedin.com/in/ada-vance' }],
    active: [{ company: 'Quillfeather Storage', role: 'Director, Widget Ops' }],
    existing: { names: new Set(), urls: new Set() },
  });
  assert.equal(r.stage1.length, 1);
  assert.equal(r.stage1[0].target.company, 'Quillfeather Storage');
});
check('a referral row at the new name is Stage 1', () => {
  const stage = stageForRow({ how: '1st-degree LinkedIn connection', where: 'Brambleton Therapy Solutions Inc', notes: '' }, new Set(companyForms('Brambleton Health')));
  assert.equal(stage, 'stage1');
});

console.log(`\nlinkedin-company-aliases: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
