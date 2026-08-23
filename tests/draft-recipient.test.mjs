#!/usr/bin/env node
/**
 * draft-recipient.test.mjs: a draft must be addressed to the person you clicked.
 *
 * WHY THIS EXISTS
 * The three contact books number their rows independently, so referral 88 and
 * target-talent 88 are two different people. Three handlers in
 * routes/linkedin-drafts.mjs looked a contact up by id ALONE, always against the
 * target-talent book, whatever source was asked for.
 *
 * That was harmless while target talent was the only book reaching the follow-up
 * queue. It stopped being harmless the moment referrals and influencers joined it:
 * clicking Draft on a referral produced a note addressed to whoever held that id
 * in the OTHER book, naming the wrong person and the wrong employer, rendered
 * under the row you clicked and one click away from being sent. It was found by
 * looking at the screen, not by a test, because every test used target-talent
 * fixtures where an id-only lookup happens to be correct.
 *
 * So these fixtures deliberately give a referral and a target-talent contact the
 * SAME id, which is the ordinary case in real data and the one no fixture covered.
 * The model is stubbed, so this costs nothing to run.
 *
 * Run: node tests/draft-recipient.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.TJK_FAKE_LLM = '1';
// The stub echoes nothing back, so assertions read the PROMPT the handler built
// rather than the model output: what matters is who the handler thinks it is
// writing to.
process.env.TJK_FAKE_LLM_TEXT = 'Stub note.';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-recipient-'));
process.env.TJK_DATA_DIR = sandbox;
const profile = path.join(sandbox, 'profile.yml');
process.env.TJK_PROFILE_YML = profile;
fs.writeFileSync(profile, 'outreach:\n  enabled: false\n');

// id 88 in BOTH books, two different people. This is the collision.
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' +
  '| 88 | Umbrella | Stone | Dana | Ms. | Recruiter | Austin | TX | 78701 | 555 | dana@umbrella.example | linkedin.com/in/dana-stone-ex | Not Contacted |  |  |  |\n',
  'utf8');

// Written directly rather than through appendReferralRows, which assigns max+1 and
// would land on 1 in an empty sandbox. The id has to be 88 on both sides or the
// collision this exists to test does not happen.
fs.writeFileSync(path.join(sandbox, 'referrals.md'),
  '# Referral tracker\n\n' +
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n' +
  '|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|\n' +
  '| 88 | Priya Raman | 1st-degree LinkedIn connection | Initech |  | Not Asked |  |  | https://www.linkedin.com/in/priya-raman-ex |  |\n',
  'utf8');
const { parseReferralsMd } = await import('../dashboard-web/server/lib/referrals.mjs');
const referral = parseReferralsMd().find(r => r.id === 88) || {};

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/linkedin-drafts.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (p, body) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('draft-recipient.test.mjs');

console.log('\n1. The referral and the TA contact really do collide on id');
check(referral.id === 88, `the referral fixture landed on id 88 (got ${referral.id})`);

console.log('\n2. A connect note for a referral names the REFERRAL');
{
  const res = await post('/api/linkedin-drafts/connect-note', { source: 'referral', id: 88 });
  const blob = JSON.stringify(res.body);
  check(res.status === 200, `connect-note returns 200 (got ${res.status})`);
  check(/Priya/.test(blob), 'the draft is addressed to the referral');
  // The whole bug in one assertion.
  check(!/Dana/.test(blob) && !/Umbrella/.test(blob),
    'the draft never mentions the target-talent contact who shares that id');
}

console.log('\n3. A connect note for TA still names the TA contact');
{
  const res = await post('/api/linkedin-drafts/connect-note', { source: 'ta', id: 88 });
  const blob = JSON.stringify(res.body);
  check(res.status === 200 && /Dana/.test(blob), 'the target-talent path is unchanged');
  check(!/Priya/.test(blob), 'and does not leak the referral');
}

console.log('\n4. An unknown id in the named book is refused, never redirected');
{
  const res = await post('/api/linkedin-drafts/connect-note', { source: 'referral', id: 9999 });
  const blob = JSON.stringify(res.body);
  check(!/Dana/.test(blob) && !/Umbrella/.test(blob),
    'a missing referral does not silently fall back to the other book');
}

console.log('\n5. Archiving refuses rather than writing to the wrong book');
{
  const before = fs.readFileSync(path.join(sandbox, 'target-talent.md'), 'utf8');
  const res = await post('/api/linkedin-drafts/archive-contact', { source: 'referral', id: 88, reason: 'left-company' });
  const after = fs.readFileSync(path.join(sandbox, 'target-talent.md'), 'utf8');
  check(res.status === 400, `archiving a referral is refused (got ${res.status})`);
  // The important half: it is a WRITE, so refusing must also mean not writing.
  check(before === after, 'the target-talent book is byte-identical after the refusal');
  const ok = await post('/api/linkedin-drafts/archive-contact', { source: 'ta', id: 88, reason: 'left-company' });
  check(ok.status === 200, 'archiving a target-talent contact still works');
}

server.closeAllConnections?.();
await new Promise(resolve => server.close(() => resolve()));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '🟢' : '🔴'} draft-recipient: ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
