#!/usr/bin/env node
/**
 * followups-stale-mute.test.mjs - a muted contact ("Done for now") must leave the
 * stale list (warm and items), not only the Follow-ups queue.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('followups-stale-mute');
process.env.TJK_DATA_DIR = sandbox;

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = localDate();
const past = localDate(-3);
const oldTouch = localDate(-20);
const sequenceId = 'application-day-0-1-5-12';

const sequences = {
  'ta:7101': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: today, paused: false, completedAt: null },
  'ta:7102': { sequenceId, startedAt: oldTouch, step: 0, nextStepDue: past, paused: false, completedAt: null },
};
fs.writeFileSync(path.join(sandbox, 'contact-sequences.json'), JSON.stringify(sequences, null, 2));

const contactRow = id =>
  `| ${id} | Brightwave Labs | Example | Contact${id} |  | Platform Leader |  |  |  |  |  | linkedin.com/in/contact-${id} | Sent | ${oldTouch} |  |  |`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), [
  '# Target Talent',
  '',
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  contactRow(7101),
  contactRow(7102),
  '',
].join('\n'), 'utf8');

const { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine } = await import('../lib/tracker.mjs');
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
    formatTrackerLine({
      num: 9101, date: oldTouch, company: 'Brightwave Labs', role: 'Staff Engineer',
      score: '4.0/5', status: 'Applied', pdf: '', resume: '', report: '', notes: '', url: '',
    }), ''].join('\n'), 'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/followups.mjs');
const { setMute } = await import('../dashboard-web/server/lib/sidecars.mjs');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const getStale = () => fetch(base + '/api/followups/stale').then(response => response.json());

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const hasTa = (list, id) => (list || []).some(row => row.source === 'ta' && row.id === id);

console.log('followups-stale-mute.test.mjs');

let body = await getStale();
check(hasTa(body.warm, 7101) && hasTa(body.warm, 7102), 'both due contacts show in the warm list before any mute');
check(hasTa(body.items, 7101) && hasTa(body.items, 7102), 'both due contacts show in items before any mute');

setMute(7101, true, 'ta');
body = await getStale();
check(!hasTa(body.warm, 7101), 'a muted contact leaves the warm list');
check(!hasTa(body.items, 7101), 'a muted contact leaves items');
check(!hasTa(body.cold, 7101), 'a muted contact is not moved to the cold list either');
check(hasTa(body.warm, 7102), 'an unmuted contact stays in the warm list');

setMute(7101, false, 'ta');
body = await getStale();
check(hasTa(body.warm, 7101), 'unmuting returns the contact to the warm list');

server.closeAllConnections?.();
await new Promise(resolve => server.close(resolve));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(`\nstale mute: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
