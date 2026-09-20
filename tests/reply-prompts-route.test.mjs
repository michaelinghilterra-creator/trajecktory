#!/usr/bin/env node
// E-3 and E-4 on the reply route: an explicit pick when several applications fit, an acknowledgement for an old or
// automated message, and the unmatched list. Invented data in a sandbox; no network.
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('reply-prompts-route');
process.env.TJK_DATA_DIR = sandbox;
const notesPath = path.join(sandbox, 'app-notes.json');
const syncPath = path.join(sandbox, 'google-sync.json');

const row = (id, company, role) => `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | Applied | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead') +
  row(900002, 'Zorblax Widgetry', 'Example Pulley Director') +
  row(900003, 'Quennox Ratchet Works', 'Example Gear Manager'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: '2030-03-04', 900002: '2030-03-05', 900003: '2030-03-05' }, null, 2) + '\n');
fs.writeFileSync(notesPath, '{}\n', 'utf8');

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => (String(url).startsWith('http://127.0.0.1:') ? nativeFetch(url, options) : Promise.reject(new Error('no network in this test')));

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/google.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const post = (msgId, action, body) => fetch(`${base}/api/google/replies/${msgId}/${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));
const get = (url) => fetch(`${base}${url}`).then(async r => ({ status: r.status, body: await r.json() }));
const notes = () => JSON.parse(fs.readFileSync(notesPath, 'utf8'));
const sync = () => JSON.parse(fs.readFileSync(syncPath, 'utf8'));
const human = (extra = {}) => ({ from: 'Example Personone <example.personone@zorblax.example>', subject: 'Next steps', bodyPreview: 'Invented reply.', date: '2030-03-12T15:00:00Z', ...extra });

console.log('reply-prompts-route.test.mjs');
try {
  // E-3: several applications at this employer need an explicit pick.
  let r = await post('m900001', 'log', { appId: 900001, company: 'Zorblax Widgetry', ...human() });
  check(r.status === 409 && r.body.guard.reason === 'pick_required' && Object.keys(notes()).length === 0, 'two applications at the employer: logging without an explicit pick is a 409 and writes nothing');
  r = await post('m900001', 'log', { appId: 900001, company: 'Zorblax Widgetry', pickConfirmed: true, ...human() });
  check(r.status === 200 && notes()['900001']?.length === 1, 'with the explicit pick it logs on the chosen application');

  // A single application at the employer needs no pick.
  r = await post('m900002', 'log', { appId: 900003, company: 'Quennox Ratchet Works', ...human() });
  check(r.status === 200 && notes()['900003']?.length === 1, 'one application at the employer logs without a pick');

  // A message older than the application is held for an acknowledgement.
  r = await post('m900003', 'log', { appId: 900003, company: 'Quennox Ratchet Works', ...human({ date: '2030-02-01T10:00:00Z' }) });
  check(r.status === 409 && r.body.guard.reason === 'needs_acknowledgement' && r.body.guard.warnings.some(w => w.type === 'older_than_application') && notes()['900003'].length === 1, 'a message older than the application is a 409 and writes nothing');
  r = await post('m900003', 'log', { appId: 900003, company: 'Quennox Ratchet Works', acknowledged: true, ...human({ date: '2030-02-01T10:00:00Z' }) });
  check(r.status === 200 && notes()['900003'].length === 2, 'acknowledged, it is logged');

  // An automated receipt is held; logging it as neutral with an acknowledgement works, and so does dismissing it.
  const receipt = human({ subject: 'Thank you for applying to Quennox Ratchet Works' });
  r = await post('m900004', 'log', { appId: 900003, company: 'Quennox Ratchet Works', ...receipt });
  check(r.status === 409 && r.body.guard.warnings.some(w => w.type === 'automated' && w.kind === 'receipt'), 'an automated receipt is held for an acknowledgement');
  r = await post('m900004', 'log', { appId: 900003, company: 'Quennox Ratchet Works', sentiment: 'neutral', acknowledged: true, ...receipt });
  check(r.status === 200 && /\[neutral\]/.test(notes()['900003'].at(-1).text), 'acknowledged as neutral, the receipt is logged as neutral');
  r = await post('m900005', 'dismiss', {});
  check(r.status === 200 && sync().handledReplies.m900005.action === 'dismiss', 'a receipt can be dismissed instead');

  // E-4: park a message, see it with evidence and suggestions, attach it with an explicit pick.
  r = await post('m900010', 'unmatched', { from: 'Example Personone <example.personone@zorblax.example>', subject: 'Question about the role', snippet: 'Invented snippet.', date: '2030-03-14T09:00:00Z', company: 'Zorblax Widgetry' });
  check(r.status === 200 && r.body.unmatched === true && sync().handledReplies.m900010.action === 'unmatched', 'a message can be parked as unmatched');
  r = await get('/api/google/replies/unmatched');
  const parked = r.body.items?.[0];
  check(r.status === 200 && r.body.count === 1 && parked.msgId === 'm900010' && parked.subject === 'Question about the role' && parked.snippet === 'Invented snippet.', 'the unmatched list shows the parked message with its evidence');
  check(parked.suggestions.length === 2 && parked.suggestions.every(s => [900001, 900002].includes(s.id) && s.role && 'applyDate' in s), 'and lists the applications that could fit, with role and apply date');
  check(Object.keys(notes()).every(k => !notes()[k].some(n => n.msgId === 'm900010')), 'parking attaches nothing');
  r = await post('m900010', 'log', { appId: 900002, company: 'Zorblax Widgetry', ...human({ date: '2030-03-14T09:00:00Z', subject: 'Question about the role' }) });
  check(r.status === 409 && r.body.guard.reason === 'pick_required', 'attaching from the list still needs the explicit pick');
  await post('m900010', 'log', { appId: 900002, company: 'Zorblax Widgetry', pickConfirmed: true, ...human({ date: '2030-03-14T09:00:00Z', subject: 'Question about the role' }) });
  r = await get('/api/google/replies/unmatched');
  check(notes()['900002']?.some(n => n.msgId === 'm900010') && r.body.count === 0, 'once attached it leaves the unmatched list');

  // Dismissing a parked message also takes it off the list.
  await post('m900011', 'unmatched', { from: 'x@example.test', subject: 'Other', date: '2030-03-15T09:00:00Z' });
  await post('m900011', 'dismiss', {});
  r = await get('/api/google/replies/unmatched');
  check(r.body.count === 0, 'a dismissed message leaves the unmatched list');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nreply-prompts-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
