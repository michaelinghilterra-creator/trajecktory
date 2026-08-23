#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

process.env.TJK_FAKE_LLM = '1';
process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Stub subject', body: 'Stub body.' });
const sandbox = makeSandbox("guardrail");
process.env.TJK_DATA_DIR = sandbox;
const profile = path.join(sandbox, 'profile.yml');
process.env.TJK_PROFILE_YML = profile;
fs.writeFileSync(profile, 'outreach:\n  enabled: true\n  minDaysBetweenTouches: 3\n  maxTouchesPer30d: 99\n  awaitingReplyHold: 0\n  coldOutreachCap:\n    linkedin: 99\n    email: 99\n  perCompanyPerDay: 99\n');
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n| 1 | Acme | Doe | Jane | Ms. | Recruiter | Austin | TX | 78701 | 555 | jane@acme.example | linkedin.com/in/jane-doe-ex | Sent |  |  |  |\n| 2 | Beta | Roe | Rob | Mr. | Recruiter | Austin | TX | 78701 | 555 | rob@beta.example | linkedin.com/in/rob-roe-ex | Not Contacted |  |  |  |\n', 'utf8');

const { writeTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');
const today = new Date().toISOString().slice(0, 10);
writeTTCorrespondence(1, [{ timestamp: today, direction: 'Sent', channel: 'Email', subject: 'Hello', body: 'A substantive note.' }]);
const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/target-talent.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (id, body = {}) => fetch(`${base}/api/target-talent/${id}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('draft-guardrail.test.mjs');

let result = await post(1);
check(result.status === 200 && result.body.blocked === true && !result.body.draft, 'blocked draft returns 200 with no draft body');
result = await post(1, { override: true });
check(result.status === 200 && !!result.body.draft, 'override returns a draft');
const logLines = fs.readFileSync(path.join(sandbox, 'outreach-overrides.tsv'), 'utf8').trim().split(/\r?\n/);
check(logLines.length === 2, 'override appends exactly one row');
result = await post(2);
check(result.status === 200 && !!result.body.draft && !result.body.blocked, 'unblocked request returns a draft');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
