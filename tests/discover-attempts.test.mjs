#!/usr/bin/env node
/**
 * The discover job and the try cap. Only a search that finished and found
 * nobody counts as a try. An error, a thrown failure and an answer that cannot
 * be read are kept on the side and never park a company.
 * Sandboxed data dir, replaced model call, invented companies only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('discover-attempts');
process.env.TJK_DATA_DIR = sandbox;
process.env.ANTHROPIC_API_KEY = ' ';
process.env.HUNTER_API_KEY = ' ';
process.env.MILLIONVERIFIER_API_KEY = ' ';

const header = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), header, 'utf8');
const attemptsFile = path.join(sandbox, 'contact-search-attempts.json');

const express = (await import('express')).default;
const routeModule = await import('../dashboard-web/server/routes/tt-reconcile.mjs');

const generate = async (prompt) => {
  if (prompt.includes('Zorblax Systems')) throw new Error('Invented model failure');
  if (prompt.includes('Quennox Labs')) return '[]';
  if (prompt.includes('Vexmoor Works')) return 'No structured result.';
  return JSON.stringify([{
    first: 'Avery', last: 'Example', title: 'Talent Partner',
    linkedin: 'https://linkedin.example/in/avery-example', confidence: 'high', notes: 'Invented fixture source.',
  }]);
};

const app = express();
app.locals.generate = generate;
app.use(express.json());
app.use(routeModule.router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const runJob = async () => {
  const started = await fetch(`${base}/api/tt-reconcile/discover-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      talent: [
        { company: 'Zorblax Systems', exampleRole: 'Operations Lead' },
        { company: 'Quennox Labs', exampleRole: 'Operations Lead' },
        { company: 'Vexmoor Works', exampleRole: 'Operations Lead' },
        { company: 'Found Example', exampleRole: 'Operations Lead' },
      ],
      principal: [],
    }),
  }).then(response => response.json());
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = await fetch(`${base}/api/tt-reconcile/discover-run/${started.jobId}`).then(response => response.json());
    if (job.status === 'done') return job;
    await delay(10);
  }
  throw new Error('Timed out waiting for the discovery job.');
};

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('discover-attempts.test.mjs');

// Three runs: under the old rule the failing company would be parked after two.
let job;
for (let run = 0; run < 3; run++) job = await runJob();
const stored = JSON.parse(fs.readFileSync(attemptsFile, 'utf8'));

check(job.errors.some(item => item.company === 'Zorblax Systems'), 'the failing search is reported as an error');
check(!stored.zorblaxsystems.talent, 'three failed searches record zero tries');
check(stored.zorblaxsystems.errors.talent === 3, 'the three failures are counted on the side');
check(/Invented model failure/.test(stored.zorblaxsystems.lastError.message), 'the last failure text is stored');
check(stored.quennoxlabs.talent === 3 && stored.quennoxlabs.confirmed.talent === 3, 'a finished search that found nobody counts every time');
check(!stored.vexmoorworks.talent && stored.vexmoorworks.errors.talent === 3, 'an answer that cannot be read is not a try');
check(!Object.hasOwn(stored, 'foundexample'), 'a search that found someone records nothing');

const preview = await fetch(`${base}/api/tt-reconcile/preview`).then(response => response.json());
check(Array.isArray(preview.toArchive), 'the preview still answers after the runs');
check(preview.engine === 'model', 'preview reports the model fallback engine');
check(preview.searchesPerCompany === 4, 'preview reports talent searches per company');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
