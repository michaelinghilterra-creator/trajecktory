#!/usr/bin/env node
/**
 * bulk-add-gate.test.mjs
 *
 * Mounts the real Express router, following people-routes.test.mjs, because the
 * route can be exercised hermetically through TJK_DATA_DIR. This pins the actual
 * write boundary instead of a helper that could drift away from the endpoint.
 * All people and domains are invented .example fixtures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('bulk-add-gate');
process.env.TJK_DATA_DIR = sandbox;
// A truthy whitespace override prevents a developer's local API keys from
// turning this hermetic route test into an email lookup.
process.env.HUNTER_API_KEY = ' ';
process.env.MILLIONVERIFIER_API_KEY = ' ';

const header = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const seed = '| 1 | Acme Example | Existing | Erin |  | Talent Partner |  |  |  |  |  |  | Not Contacted |  |  | https://www.acme.example/careers |\n';
const targetFile = path.join(sandbox, 'target-talent.md');
const reset = () => fs.writeFileSync(targetFile, header + seed, 'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/tt-reconcile.mjs');
const { parseTargetTalentMd } = await import('../dashboard-web/server/lib/target-talent.mjs');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async body => {
  const response = await fetch(`${base}/api/tt-reconcile/bulk-add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('bulk-add-gate.test.mjs');

const unsupported = {
  company: 'Acme Example',
  first: 'Avery',
  last: 'Unsupported',
  title: 'Director Revenue Operations',
  notes: 'Model proposal',
};

reset();
const rejected = await post({ source: 'agent', contacts: [unsupported] });
check(rejected.status === 200 && rejected.body.gated === true, 'agent source runs the gate');
check(rejected.body.written === 0 && rejected.body.rejected.length === 1
  && rejected.body.rejected[0].reasons.includes('no corroboration'),
  'uncorroborated agent contact is rejected with reasons and writes nothing');
check(parseTargetTalentMd().length === 1, 'rejected agent contact never reaches the contact file');

reset();
const supported = {
  company: 'Acme Example',
  first: 'Casey',
  last: 'Confirmed',
  title: 'Director Revenue Operations',
  email: 'casey@acme.example',
  notes: 'Public company biography',
};
const accepted = await post({ source: 'agent', contacts: [supported] });
const acceptedRow = parseTargetTalentMd().find(row => row.first === 'Casey');
check(accepted.body.gated === true && accepted.body.written === 1 && accepted.body.rejected.length === 0,
  'corroborated agent contact passes the gate and is written');
check(/\[tier:hm\]/.test(acceptedRow?.notes || '') && /\[src:agent:\d{4}-\d{2}-\d{2}\]/.test(acceptedRow?.notes || ''),
  'written agent notes carry the tier tag and provenance stamp');

reset();
const manual = await post({ source: 'manual', contacts: [unsupported] });
const manualRow = parseTargetTalentMd().find(row => row.first === 'Avery');
check(manual.body.gated === false && manual.body.written === 1 && manual.body.rejected.length === 0,
  'manual source bypasses the gate for the same uncorroborated contact');
check(manualRow?.notes === unsupported.notes && !/\[tier:|\[src:/.test(manualRow?.notes || ''),
  'manual contact is written without validation stamps or field changes');

reset();
const legacy = await post({ contacts: [unsupported] });
// Email finding now runs in the background, so the response returns
// emailVerification ('running' | 'skipped') instead of the old synchronous
// emailsFound / budgetHit counts.
const responseFields = [
  'emailVerification', 'gated', 'ok', 'rejected', 'requested',
  'skipped', 'verifierKeys', 'written',
];
check(legacy.body.gated === false && legacy.body.rejected.length === 0,
  'missing source reports the ungated path');
check(JSON.stringify(Object.keys(legacy.body).sort()) === JSON.stringify(responseFields.slice().sort())
  && legacy.body.requested === 1 && legacy.body.written === 1 && legacy.body.skipped === 0,
  'missing source preserves the response fields and adds only gate metadata');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
