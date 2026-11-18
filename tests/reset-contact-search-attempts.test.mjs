#!/usr/bin/env node
/**
 * reset-contact-search-attempts.mjs and the "Give it another try" route.
 * The script runs as a child process against a sandboxed data dir, so it can
 * never reach a real file. Invented companies only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'reset-contact-search-attempts.mjs');
const sandbox = makeSandbox('reset-attempts');
const file = path.join(sandbox, 'contact-search-attempts.json');

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

// zorblaxsystems: parked on talent by tries from before the fix (no confirmed mark).
// quennoxlabs:    parked on principal by two confirmed empty searches.
// vexmoorworks:   one old talent try, below the cap; parked on principal with one confirmed.
const seed = () => ({
  zorblaxsystems: { talent: 2, lastSearched: '2031-01-05' },
  quennoxlabs: { principal: 2, confirmed: { principal: 2 }, lastSearched: '2031-01-06' },
  vexmoorworks: { talent: 1, principal: 2, confirmed: { principal: 1 }, errors: { talent: 4 }, lastSearched: '2031-01-07' },
});
const write = data => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [SCRIPT, '--json', ...args], {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TJK_DATA_DIR: sandbox },
}));
const backups = () => fs.readdirSync(sandbox).filter(name => name.includes('.bak-'));

console.log('reset-contact-search-attempts.test.mjs');

// Dry run is the default and writes nothing.
write(seed());
const before = fs.readFileSync(file, 'utf8');
const dry = run();
check(dry.applied === false && fs.readFileSync(file, 'utf8') === before, 'a dry run changes nothing on disk');
check(backups().length === 0, 'a dry run makes no backup');
check(dry.canTellErrorsApart === false, 'the report says old error tries cannot be told apart');
check(dry.legacyTries === 4, 'the report counts the unconfirmed tries in scope');
check(dry.cleared.map(row => `${row.company}:${row.tier}:${row.clear}`).sort().join() === 'vexmoorworks:principal:1,zorblaxsystems:talent:2',
  'by default it clears the unconfirmed tries of companies at the cap');
check(dry.keptConfirmed.length === 1 && dry.keptConfirmed[0].company === 'quennoxlabs', 'a company parked only by confirmed empty searches is reported and kept');

// Apply writes after a backup.
const applied = run('--apply');
const after = read();
check(applied.applied === true && backups().length === 1, 'apply makes one timestamped backup');
check(fs.readFileSync(path.join(sandbox, backups()[0]), 'utf8') === before, 'the backup holds the file as it was');
check(after.zorblaxsystems.talent === 0, 'apply clears the parked company');
check(after.vexmoorworks.principal === 1 && after.vexmoorworks.confirmed.principal === 1, 'apply keeps the confirmed empty search');
check(after.vexmoorworks.talent === 1, 'a company below the cap is left alone by default');
check(after.quennoxlabs.principal === 2, 'confirmed empty searches stay parked without the all flag');
check(after.vexmoorworks.errors.talent === 4 && after.zorblaxsystems.lastSearched === '2031-01-05', 'error counts and dates are untouched');

// Tier filter.
write(seed());
run('--apply', '--tier', 'principal');
check(read().zorblaxsystems.talent === 2 && read().vexmoorworks.principal === 1, 'the tier filter resets only that search type');

// All: confirmed empty searches go too.
write(seed());
run('--apply', '--all');
check(read().quennoxlabs.principal === 0 && read().vexmoorworks.principal === 0 && read().zorblaxsystems.talent === 0, 'the all flag also clears confirmed empty searches');
check(read().vexmoorworks.talent === 1, 'the all flag still leaves companies below the cap');

// Below cap and one company.
write(seed());
run('--apply', '--below-cap', '--company', 'Vexmoor Works');
check(read().vexmoorworks.talent === 0 && read().zorblaxsystems.talent === 2, 'the company filter and below-cap flag reach one company only');

// A missing file is an empty plan, not a crash, and apply writes nothing.
fs.rmSync(file);
const missing = run('--apply');
check(missing.cleared.length === 0 && !fs.existsSync(file), 'a missing file yields nothing to clear and is not created');

let badTier = false;
try { run('--tier', 'sideways'); } catch { badTier = true; }
check(badTier, 'an unknown tier is refused');

// The route behind the "Give it another try" button.
write(seed());
process.env.TJK_DATA_DIR = sandbox;
const express = (await import('express')).default;
const routeModule = await import('../dashboard-web/server/routes/tt-reconcile.mjs');
const app = express();
app.use(express.json());
app.use(routeModule.router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const post = async body => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tt-reconcile/reset-attempts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const one = await post({ company: 'Vexmoor Works, Inc.', search: 'principal' });
check(one.status === 200 && one.body.removed === 2, 'the route clears one search type for one company');
check(read().vexmoorworks.principal === 0 && read().vexmoorworks.talent === 1 && read().zorblaxsystems.talent === 2, 'the route touches nothing else');
check((await post({ company: 'Zorblax Systems' })).body.removed === 2, 'the route clears both search types when none is named');
check((await post({ company: 'Nobody Example', search: 'talent' })).body.removed === 0, 'an unknown company removes nothing');
check((await post({ search: 'talent' })).status === 400, 'a missing company is refused');
check((await post({ company: 'Zorblax Systems', search: 'sideways' })).status === 400, 'an unknown search type is refused');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
