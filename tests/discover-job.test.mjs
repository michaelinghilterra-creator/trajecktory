#!/usr/bin/env node
/**
 * Mount the real reconcile router against an isolated contact book. The model
 * call is replaced so this suite uses no credential, network, or real company.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('discover-job');
process.env.TJK_DATA_DIR = sandbox;
process.env.ANTHROPIC_API_KEY = ' ';
process.env.HUNTER_API_KEY = ' ';
process.env.MILLIONVERIFIER_API_KEY = ' ';

const header = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const targetFile = path.join(sandbox, 'target-talent.md');
fs.writeFileSync(targetFile, header, 'utf8');

const express = (await import('express')).default;
const routeModule = await import('../dashboard-web/server/routes/tt-reconcile.mjs');
process.env.ANTHROPIC_API_KEY = ' ';
process.env.HUNTER_API_KEY = ' ';
process.env.MILLIONVERIFIER_API_KEY = ' ';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const generateCalls = [];
const generate = async (prompt, options) => {
  generateCalls.push({ prompt, options });
  const company = ['Alpha Example', 'Beta Example', 'Broken Example', 'Delta Example']
    .find(name => prompt.includes(name));
  const waits = { 'Alpha Example': 40, 'Beta Example': 180, 'Broken Example': 80, 'Delta Example': 240 };
  await delay(waits[company] || 20);
  if (company === 'Broken Example') throw new Error('Invented model failure');
  const first = company.split(' ')[0];
  return JSON.stringify([{
    first,
    last: 'Person',
    title: prompt.includes('HIRING MANAGER') ? 'VP Operations' : 'Talent Partner',
    linkedin: `https://linkedin.example/in/${first.toLowerCase()}-person`,
    confidence: 'high',
    notes: 'Invented fixture source.',
  }]);
};

const app = express();
app.locals.generate = generate;
app.use(express.json());
app.use(routeModule.router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const nativeFetch = globalThis.fetch;

const get = async suffix => {
  const response = await nativeFetch(`${base}/api/tt-reconcile/discover-run${suffix}`);
  return { status: response.status, body: await response.json() };
};
const post = async body => {
  const response = await nativeFetch(`${base}/api/tt-reconcile/discover-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(10);
  }
  throw new Error('Timed out waiting for discovery state.');
};

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('discover-job.test.mjs');

const initiallyRunning = await get('');
check(initiallyRunning.status === 200 && initiallyRunning.body === null, 'running endpoint returns null before a run starts');

const started = await post({
  talent: [
    { company: 'Alpha Example', exampleRole: 'Operations Lead', timeoutMs: 9e15, model: 'request-model.example' },
    { company: 'Broken Example', exampleRole: 'Operations Lead' },
  ],
  principal: [
    { company: 'Beta Example', exampleRole: 'Revenue Operations' },
    { company: 'Delta Example', exampleRole: 'Revenue Operations' },
  ],
});
const jobId = started.body.jobId;
const immediate = await get(`/${jobId}`);
check(started.status === 200 && typeof jobId === 'string', 'start returns a job id');
check(immediate.body.status === 'running', 'start response arrives while work is still running');

const attached = await get('');
check(attached.body?.jobId === jobId && attached.body.status === 'running', 'running endpoint returns the active job');

const partial = await waitFor(async () => {
  const polled = await get(`/${jobId}`);
  return polled.body.done > 0 && polled.body.done < polled.body.total ? polled.body : null;
});
check(partial.done > 0 && partial.results.length > 0, 'polling exposes increasing done and partial results');
check(partial.results.length + partial.errors.length === partial.done, 'every partial completion is accounted for');

const final = await waitFor(async () => {
  const polled = await get(`/${jobId}`);
  return polled.body.status === 'done' ? polled.body : null;
});
check(final.status === 'done' && final.done === final.total, 'final record is done with every company completed');
check(final.errors.some(item => item.company === 'Broken Example' && /Invented model failure/.test(item.error)), 'one thrown search lands in errors');
check(final.results.some(item => item.company === 'Alpha Example'), 'one thrown search does not stop other companies');
check(final.results.length + final.errors.length === final.total, 'every company lands in exactly one outcome collection');
check(final.results.every(item => ['talent', 'principal'].includes(item.search)), 'each result identifies the search that produced it');
check(final.results.every(item => Array.isArray(item.suggestions) && Array.isArray(item.rejected) && Number.isFinite(item.duplicates)), 'each result has the complete incremental outcome shape');
const alphaGenerateCall = generateCalls.find(call => call.prompt.includes('Alpha Example'));
check(
  alphaGenerateCall
    && alphaGenerateCall.options.model !== 'request-model.example'
    && !Object.hasOwn(alphaGenerateCall.options, 'timeoutMs'),
  'the job route does not forward request timeout or model fields to discovery generation',
);

const after = await get('');
check(after.body === null, 'running endpoint returns null after the run finishes');
const missing = await get('/invented-unknown-job');
check(missing.status === 404, 'unknown job id returns 404');
check(fs.readFileSync(targetFile, 'utf8') === header, 'background discovery never writes to the contact file');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
