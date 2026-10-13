#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox("people");
process.env.TJK_DATA_DIR = sandbox;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n| 1 | Acme | Smith | Jane |  | Recruiter |  |  |  |  |  | linkedin.com/in/jane-smith | Sent |  |  |  |\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'referrals.md'), '# Referral tracker\n\n| # | Name | How | Where | Target | Status | Last Touch | Notes | LinkedIn | Email |\n|---|---|---|---|---|---|---|---|---|---|\n| 1 | Jane Smith | Friend | Acme |  | Not Asked |  |  | linkedin.com/in/jane-other |  |\n', 'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/people.mjs');
const { parseTargetTalentMd } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { parseReferralsMd, REFERRAL_HEADER } = await import('../dashboard-web/server/lib/referrals.mjs');
const { resolvePeople } = await import('../dashboard-web/server/lib/contact-identity.mjs');
const { readPins } = await import('../dashboard-web/server/lib/contact-links.mjs');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const sidecar = path.join(sandbox, 'contact-links.json');
const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const groups = () => resolvePeople({ ta: parseTargetTalentMd(), referrals: parseReferralsMd(), pins: readPins() }).map(p => p.refs);
let passed = 0, failed = 0;
const check = (condition, message) => { if (condition) { console.log(`  ✅ ${message}`); passed++; } else { console.log(`  ❌ ${message}`); failed++; } };

console.log('people-routes.test.mjs');
const before = groups();
await post('/api/people/merge', { a: 'ta:1', b: 'referral:1', note: 'test' });
check(readPins()['ta:1']?.with === 'referral:1' && groups().some(g => g.length === 2), 'merge writes a pin and resolves both refs together');
await post('/api/people/unmerge', { ref: 'ta:1' });
check(readPins()['ta:1']?.alone === true && groups().every(g => g.length === 1), 'unmerge writes an alone pin and resolves refs apart');
check(JSON.stringify(groups()) === JSON.stringify(before), 'merge then unmerge restores the exact pre-merge grouping');

fs.writeFileSync(sidecar, JSON.stringify({ version: 1, pins: {} }));
fs.writeFileSync(path.join(sandbox, 'referrals.md'), fs.readFileSync(path.join(sandbox, 'referrals.md'), 'utf8').replace('linkedin.com/in/jane-other', 'linkedin.com/in/jane-smith'));
await post('/api/people/suggestions/reject', { a: 'ta:1', b: 'referral:1' });
fs.mkdirSync(path.join(sandbox, 'linkedin-ssi'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'linkedin-ssi', 'influencers.json'), JSON.stringify([{ id: 1, name: 'Jane Smith', company: 'Acme', linkedinUrl: 'linkedin.com/in/jane-smith' }]));
const pathology = resolvePeople({ ta: parseTargetTalentMd(), referrals: parseReferralsMd(), influencers: JSON.parse(fs.readFileSync(path.join(sandbox, 'linkedin-ssi', 'influencers.json'))), pins: readPins() });
check(pathology.find(p => p.refs.includes('ta:1'))?.refs.length === 1 && pathology.some(p => p.refs.includes('referral:1') && p.refs.includes('influencer:1')), 'rejected side stays separate when a third row shares the LinkedIn key');

const pinsBeforeBadRef = JSON.stringify(readPins());
const bad = await post('/api/people/merge', { a: 'bad:1', b: 'referral:1' });
check(bad.status === 400 && JSON.stringify(readPins()) === pinsBeforeBadRef, 'malformed ref returns 400 and writes nothing');
fs.rmSync(sidecar);
check(groups().some(g => g.length === 2), 'deleting the sidecar restores unpinned grouping');

fs.writeFileSync(path.join(sandbox, 'target-talent.md'), '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n| 1 | Zorblax Widgetry | Personone | Example |  | Recruiter |  |  |  |  | example.personone@example.test [v:ok:2030-01-01] |  | Responded |  |  |  |\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'referrals.md'), REFERRAL_HEADER, 'utf8');

const createdResponse = await post('/api/people/create', {
  name: '  Example   Persontwo  ',
  company: ' Zorblax Widgetry ',
  email: 'example.persontwo@example.test',
  title: 'Example Cog Lead',
  notes: 'Met through an invented event',
});
const created = await createdResponse.json();
let referralRows = parseReferralsMd();
check(createdResponse.status === 200 && created.existed === false && created.ref.startsWith('referral:'), 'create adds a new referral person');
check(referralRows.length === 1 && referralRows[0].status === 'Responded', 'create defaults the status to Responded');
check(referralRows[0].notes.split(' · ')[0] === 'Example Cog Lead', 'the title is the first notes segment');

const countBeforeEmailDedupe = referralRows.length;
const emailDedupeResponse = await post('/api/people/create', {
  name: 'Example Personthree', company: 'Quennox Ratchet Works', email: 'EXAMPLE.PERSONTWO@EXAMPLE.TEST',
});
const emailDedupe = await emailDedupeResponse.json();
referralRows = parseReferralsMd();
check(emailDedupe.existed === true && emailDedupe.ref === created.ref && referralRows.length === countBeforeEmailDedupe, 'email dedupe ignores case and writes no second row');

const nameDedupe = await (await post('/api/people/create', {
  name: 'Example Persontwo', company: 'Zorblax Widgetry',
})).json();
check(nameDedupe.existed === true && nameDedupe.ref === created.ref, 'name and company dedupe finds the referral row');

const taDedupe = await (await post('/api/people/create', {
  name: 'Example Personthree', company: 'Quennox Ratchet Works', email: 'EXAMPLE.PERSONONE@EXAMPLE.TEST',
})).json();
check(taDedupe.existed === true && taDedupe.ref === 'ta:1' && taDedupe.name === 'Example Personone', 'a tagged TA email matches and returns the stored person');

const secondCreateResponse = await post('/api/people/create', {
  name: 'Example Persontwo', company: 'Quennox Ratchet Works', email: 'example.persontwo.alt@example.test',
});
const secondCreate = await secondCreateResponse.json();
check(secondCreate.existed === false, 'the same name at a different company creates a new person');
check(secondCreate.ref !== created.ref, 'two sequential creates receive different ids');

const relay = await post('/api/people/create', {
  name: 'Example Personone', company: 'Zorblax Widgetry', email: 'reply@jobvite.example.test',
});
check(relay.status === 400 && (await relay.json()).error.includes('relay address'), 'an ATS relay email returns 400');
const missingName = await post('/api/people/create', { company: 'Zorblax Widgetry' });
check(missingName.status === 400, 'a missing name returns 400');
const missingCompany = await post('/api/people/create', { name: 'Example Personone' });
check(missingCompany.status === 400, 'a missing company returns 400');
const invalidStatus = await post('/api/people/create', {
  name: 'Example Personthree', company: 'Quennox Ratchet Works', status: 'Invented status',
});
check(invalidStatus.status === 400, 'an invalid status returns 400');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
