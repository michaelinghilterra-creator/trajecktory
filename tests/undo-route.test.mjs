#!/usr/bin/env node
// E-6: undo through the routes with the event store on. Status changes, a logged reply and their side effects go
// back to exactly what they were; the original events stay in the log. Invented data in a sandbox; no network.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('undo-route');
process.env.TJK_DATA_DIR = sandbox;

const row = (id, company, role, status) => `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Evaluated') +
  row(900003, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), '{}\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { renderLegacyFile } = await import('../lib/legacy-files.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
{
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(st, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  st.close();
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => (String(url).startsWith('http://127.0.0.1:') ? nativeFetch(url, options) : Promise.reject(new Error('no network in this test')));

const express = (await import('express')).default;
const { router: appsRouter } = await import('../dashboard-web/server/routes/applications.mjs');
const { router: googleRouter } = await import('../dashboard-web/server/routes/google.mjs');
const { router: eventRouter } = await import('../dashboard-web/server/routes/event-actions.mjs');
const { parseApplicationsMd } = await import('../dashboard-web/server/lib/applications.mjs');
const app = express();
app.use(express.json());
app.use(appsRouter);
app.use(googleRouter);
app.use(eventRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const send = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));
const files = ['applications.md', 'status-events.tsv', 'apply-dates.json', 'app-notes.json'];
const snapshot = () => Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(sandbox, f), 'utf8')]));
const sameFiles = (a, b) => files.every(f => a[f] === b[f]);
const allEvents = () => { const st = openEventStore(path.join(sandbox, 'trajecktory.db')); const e = readEvents(st); st.close(); return e; };
const projectedNotes = () => {
  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const text = renderLegacyFile(st, 'app-notes.json');
  st.close();
  return text ? JSON.parse(text) : {};
};
// The parsed tracker is cached on the file time; writes in the same millisecond would look unchanged, so move it on.
let tick = Date.now();
const statusOf = (id) => { tick += 2000; fs.utimesSync(path.join(sandbox, 'applications.md'), tick / 1000, tick / 1000); return parseApplicationsMd().find(r => r.id === id)?.status; };
const recent = () => send('GET', '/api/events/recent').then(r => r.body);

console.log('undo-route.test.mjs');
try {
  const start = snapshot();

  // A status change to Applied (which also sets the apply date) is one action and undoes cleanly.
  let r = await send('PATCH', '/api/applications/900001', { status: 'Applied' });
  check(r.status === 200 && statusOf(900001) === 'Applied', 'the status change is saved');
  let list = await recent();
  check(list.enabled && list.actions.length === 1 && list.actions[0].undoable && list.actions[0].company === 'Zorblax Widgetry' && /Evaluated to Applied/.test(list.actions[0].summary) && list.actions[0].member_ids.length === 1, 'it shows as one undoable action with the company and what changed');
  const eventId = list.actions[0].event_id;
  r = await send('POST', `/api/events/${eventId}/undo`, {});
  check(r.status === 200 && statusOf(900001) === 'Evaluated', 'undo puts the status back');
  check(sameFiles(snapshot(), start), 'and every file is exactly what it was before the change, including the apply date and the status event');
  check(allEvents().some(e => e.id === eventId), 'the original event is still in the log');
  list = await recent();
  check(list.actions.length === 0, 'an undone action leaves the list');
  r = await send('POST', `/api/events/${eventId}/undo`, {});
  check(r.status === 404, 'undoing it again is a 404');

  // An older change is blocked while a newer one exists on the same application.
  await send('PATCH', '/api/applications/900001', { status: 'Applied' });
  const first = (await recent()).actions[0].event_id;
  await send('PATCH', '/api/applications/900001', { status: 'Passed', passedReason: 'skip' });
  list = await recent();
  const [newer, older] = list.actions;
  check(newer.undoable && !older.undoable && older.blocked_reason === 'newer_change' && older.event_id === first, 'the newest change can be undone and the older one is blocked');
  r = await send('POST', `/api/events/${older.event_id}/undo`, {});
  check(r.status === 409 && r.body.blocked_reason === 'newer_change', 'undoing the blocked one is a 409');
  await send('POST', `/api/events/${newer.event_id}/undo`, {});
  check(statusOf(900001) === 'Applied', 'undoing the newer one restores the earlier status');
  r = await send('POST', `/api/events/${older.event_id}/undo`, {});
  check(r.status === 200 && statusOf(900001) === 'Evaluated' && sameFiles(snapshot(), start), 'then the older one can be undone and everything is back to the start');

  // A logged reply that flips the status: the note, the handled record and the status all go back.
  const beforeReply = snapshot();
  const syncPath = path.join(sandbox, 'google-sync.json');
  r = await send('POST', '/api/google/replies/m900001/rejected', { appId: 900003, company: 'Quennox Ratchet Works', from: 'Example Personone <example.personone@quennox.example>', subject: 'Your application', bodyPreview: 'Invented rejection.', date: '2030-03-12T10:00:00Z' });
  if (r.status !== 200) console.log(JSON.stringify(r.body).slice(0, 300));
  check(r.status === 200 && statusOf(900003) === 'Rejected' && projectedNotes()['900003']?.length === 1, 'the reply note is projected from the event and the status flipped');
  list = await recent();
  check(list.actions.length === 1 && list.actions[0].type === 'reply_attached' && list.actions[0].undoable && list.actions[0].member_ids.length === 1 && /Reply logged, status set to Rejected/.test(list.actions[0].summary), 'the reply and its status flip are one action');
  const replyEventId = list.actions[0].event_id;
  const loggedReply = allEvents().find((event) => event.id === replyEventId);
  check(loggedReply?.payload?.legacy_effects?.some((effect) => effect.file === 'app-notes.json' && effect.op === 'json_nested_append'), 'the reply event itself owns the note effect');
  r = await send('POST', `/api/events/${replyEventId}/undo`, { reason: 'wrong_record' });
  check(r.status === 200 && r.body.note_removed === true, 'undoing the reply removes the note');
  check(statusOf(900003) === 'Applied', 'the status is back');
  check(!JSON.parse(fs.readFileSync(syncPath, 'utf8')).handledReplies?.m900001, 'the message is no longer marked handled, so the sweep shows it again');
  const after = snapshot();
  const history = allEvents();
  check(after['applications.md'] === beforeReply['applications.md'] && after['status-events.tsv'] === beforeReply['status-events.tsv']
    && !projectedNotes()['900003']
    && history.some((event) => event.id === replyEventId)
    && history.some((event) => event.type === 'event_undone' && event.corrects_event_id === replyEventId),
  'the note is void-suppressed in the projection while its original event remains recoverable');

  // Refusals.
  r = await send('POST', '/api/events/1/undo', {});
  check(r.status === 404, 'an event that is not one of your changes is a 404');
  r = await send('POST', '/api/events/abc/undo', {});
  check(r.status === 400, 'a bad id is a 400');
  r = await send('POST', '/api/events/1/undo', { reason: 'nonsense' });
  check(r.status === 400, 'an unknown reason is a 400');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nundo-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
