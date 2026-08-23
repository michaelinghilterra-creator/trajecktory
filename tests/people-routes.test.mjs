#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-people-'));
process.env.TJK_DATA_DIR = sandbox;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n| 1 | Acme | Smith | Jane |  | Recruiter |  |  |  |  |  | linkedin.com/in/jane-smith | Sent |  |  |  |\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'referrals.md'), '# Referral tracker\n\n| # | Name | How | Where | Target | Status | Last Touch | Notes | LinkedIn | Email |\n|---|---|---|---|---|---|---|---|---|---|\n| 1 | Jane Smith | Friend | Acme |  | Not Asked |  |  | linkedin.com/in/jane-other |  |\n', 'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/people.mjs');
const { parseTargetTalentMd } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { parseReferralsMd } = await import('../dashboard-web/server/lib/referrals.mjs');
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

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
