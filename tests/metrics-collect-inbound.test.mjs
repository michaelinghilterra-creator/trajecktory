#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'metrics-collect-inbound');
process.env.TJK_DATA_DIR = sandbox;
process.env.TZ = 'America/Chicago';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function writeJson(name, value) {
  fs.writeFileSync(path.join(sandbox, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function replyNote(sentOn, subject, sentiment, body) {
  return `### Reply logged (${sentOn})\nexample.person@example.test: ${subject} [${sentiment}]\n\n${body}`;
}
fs.writeFileSync(path.join(sandbox, 'applications.md'), [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  TRACKER_SEPARATOR,
  '| 900001 | 2030-03-01 | Zorblax Widgetry | Widget Engineer | 4.1/5 | Applied | | | | | https://jobs.example.test/900001 |',
  '| 900002 | 2030-03-02 | Quennox Ratchet Works | Ratchet Engineer | 4.2/5 | Applied | | | | | https://jobs.example.test/900002 |',
  '| 900003 | 2030-03-03 | Zorblax Widgetry | Widget Lead | 4.3/5 | Applied | | | | | https://jobs.example.test/900003 |',
  '| 900004 | 2030-03-04 | Quennox Ratchet Works | Ratchet Lead | 4.4/5 | Applied | | | | | https://jobs.example.test/900004 |',
  '| 900005 | 2030-03-05 | Zorblax Widgetry | Widget Manager | 4.5/5 | Applied | | | | | https://jobs.example.test/900005 |',
  '',
].join('\n'), 'utf8');
writeJson('apply-dates.json', {
  900001: '2030-03-01',
  900002: '2030-03-02',
  900003: '2030-03-03',
  900004: '2030-03-04',
  900005: '2030-03-05',
});
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), [
  'app#\tdate\tstatus\tcompany\tlogged',
  '900001\t2030-03-01\tApplied\tZorblax Widgetry\t2030-03-01',
  '900002\t2030-03-02\tApplied\tQuennox Ratchet Works\t2030-03-02',
  '900003\t2030-03-03\tApplied\tZorblax Widgetry\t2030-03-03',
  '900004\t2030-03-04\tApplied\tQuennox Ratchet Works\t2030-03-04',
  '900005\t2030-03-05\tApplied\tZorblax Widgetry\t2030-03-05',
  '',
].join('\n'), 'utf8');
const noteMap = {
  900001: [{ timestamp: '2030-03-04T15:00:00.000Z', msgId: 'm900001', text: replyNote('2030-03-04', 'Next steps', 'positive', 'Could we schedule a conversation?') }],
  900002: [{ timestamp: '2030-03-05T15:00:00.000Z', msgId: 'm900002', text: replyNote('2030-03-05', 'Next steps', 'positive', 'Could we schedule a conversation?') }],
  900003: [{ timestamp: '2030-03-06T15:00:00.000Z', msgId: 'm900003', text: replyNote('2030-03-06', 'Application received', 'neutral', 'We received your application.') }],
  900004: [{ timestamp: '2030-03-07T15:00:00.000Z', msgId: 'm900004', text: replyNote('2030-03-07', 'Follow up', 'negative', 'Unfortunately we are not moving forward.') }],
  900005: [{ timestamp: '2030-03-08T15:00:00.000Z', msgId: 'm900005', text: replyNote('2030-03-08', 'Next steps', 'positive', 'Could we schedule a conversation?') }],
};
writeJson('app-notes.json', noteMap);

const { collectCoreMetrics } = await import('../dashboard-web/server/lib/metrics-collect.mjs');
const { openEventStore, appendEvents, readEvents } = await import('../lib/event-store.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { buildEmailReceivedEvent } = await import('../lib/inbound-events.mjs');
const { buildVoidEvent } = await import('../lib/void-events.mjs');
const { resetLogWritesCache } = await import('../lib/log-writes.mjs');

console.log('metrics-collect-inbound.test.mjs');
try {
  let result = collectCoreMetrics({ today: '2030-03-10' });
  check(result.results.response.all.k === 4 && result.results.positive.all.k === 3, 'with the store off replies come from notes as before');

  writeJson('app-notes.json', {});
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }) + '\n', 'utf8');
  {
    const out = path.join(sandbox, 'fixture-output');
    fs.mkdirSync(out);
    const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
    importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
    // 900001: note says positive, its event says negative (the event must win, counted once).
    // 900002: an event and no note. 900003: a note that reads as a human reply, its event says receipt.
    // 900004: a note and no event. 900005: a note whose event was undone, so the key is no longer recorded.
    writeJson('app-notes.json', {
      900001: noteMap[900001],
      900003: [{ timestamp: '2030-03-06T15:00:00.000Z', msgId: 'm900003', text: replyNote('2030-03-06', 'Next steps', 'positive', 'Could we schedule a conversation?') }],
      900004: noteMap[900004],
      900005: noteMap[900005],
    });
    appendEvents(store, [
      buildEmailReceivedEvent({ application_id: 900001, msg_id: 'm900001', sent_on: '2030-03-04', kind: 'human', sentiment: 'negative' }),
      buildEmailReceivedEvent({ application_id: 900002, msg_id: 'event-only-900002', sent_on: '2030-03-05', kind: 'human', sentiment: 'positive' }),
      buildEmailReceivedEvent({ application_id: 900003, msg_id: 'm900003', sent_on: '2030-03-06', kind: 'receipt' }),
      buildEmailReceivedEvent({ application_id: 900005, msg_id: 'm900005', sent_on: '2030-03-08', kind: 'human', sentiment: 'positive' }),
    ]);
    const toVoid = readEvents(store, { type: 'email_received' }).find(event => event.payload.msg_id === 'm900005');
    appendEvents(store, [buildVoidEvent({
      target_event_id: toVoid.id,
      reason_code: 'undone_by_owner',
      evidence_ref: 'owner',
      actor: 'owner',
      occurred_on: '2030-03-09',
      definitions_version: 'v1',
    })]);
    store.close();
  }
  resetLogWritesCache();
  result = collectCoreMetrics({ today: '2030-03-10' });
  check(result.results.response.all.k === 4 && result.results.response.all.n === 5, 'responses are 900001, 900002 (event only), 900004 (note fallback) and 900005 (undone event, note fallback); the receipt event keeps 900003 out');
  check(result.results.positive.all.k === 2, 'positive is 900002 (event only) and 900005; 900001 follows its negative event, not its positive note');
} finally {
  resetLogWritesCache();
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`metrics-collect-inbound: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
